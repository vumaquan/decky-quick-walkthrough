import concurrent.futures
import html as html_lib
import json
import logging
import os
import re
import shutil
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("QuickWalkthrough")

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 10
CACHE_TTL_SECONDS = 300
_SEARCH_CACHE: Dict[str, Tuple[float, Any]] = {}
_LIST_CACHE: Dict[Tuple[Any, ...], Tuple[float, Any]] = {}
_UNIFIED_CACHE: Dict[Tuple[Any, ...], Tuple[float, Any]] = {}
IGN_GRAPHQL_URL = "https://mollusk.apis.ign.com/graphql"
_CURL_BIN = shutil.which("curl")

TRUSTED_GUIDE_DOMAINS = (
    "ign.com",
    "powerpyx.com",
    "eurogamer.net",
    "game8.co",
    "polygon.com",
    "steamcommunity.com",
    "strategywiki.org",
    "zeldadungeon.net",
    "fextralife.com",
    "pushsquare.com",
    "pcgamer.com",
    "gamespot.com",
    "neoseeker.com",
)


def _get_ssl_context() -> ssl.SSLContext:
    """
    Builds an SSLContext that works inside Decky Loader's PyInstaller bundle on SteamOS
    (which needs certifi or explicit system CA paths) as well as macOS/Linux.
    """
    ca_candidates: List[str] = []
    try:
        import certifi  # type: ignore

        ca_candidates.append(certifi.where())
    except Exception:
        pass

    ca_candidates.extend(
        [
            "/etc/ssl/certs/ca-certificates.crt",
            "/etc/pki/tls/certs/ca-bundle.crt",
            "/etc/ssl/cert.pem",
        ]
    )
    for cafile in ca_candidates:
        if cafile and os.path.isfile(cafile):
            try:
                return ssl.create_default_context(cafile=cafile)
            except Exception:
                continue
    return ssl.create_default_context()


_SSL_CTX = _get_ssl_context()

IGN_UNIFIED_SEARCH_QUERY = """
query UnifiedSearch($term: String!, $types: [UnifiedSearchType!], $countPerType: Int) {
  unifiedSearch(term: $term, types: $types, countPerType: $countPerType) {
    sections {
      type
      total
      items {
        id
        title
        type
        thumbnailUrl
        url
      }
    }
  }
}
""".strip()


def _clean_subprocess_env() -> Dict[str, str]:
    """
    Removes PyInstaller's LD_LIBRARY_PATH (_MEI...) and Steam's LD_PRELOAD
    so /usr/bin/curl uses SteamOS system OpenSSL/libcurl cleanly.
    """
    env = dict(os.environ)
    if "LD_LIBRARY_PATH_ORIG" in env:
        env["LD_LIBRARY_PATH"] = env["LD_LIBRARY_PATH_ORIG"]
    else:
        env.pop("LD_LIBRARY_PATH", None)
    env.pop("LD_PRELOAD", None)
    return env


def _curl_request(
    url: str,
    method: str = "GET",
    data: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[str]:
    if not _CURL_BIN:
        return None
    cmd = [
        _CURL_BIN,
        "-4",
        "-sSL",
        "--compressed",
        "--connect-timeout",
        "4",
        "--max-time",
        str(max(4, int(timeout))),
        "-A",
        USER_AGENT,
        "-w",
        "\n__CURL_STATUS__:%{http_code}",
    ]
    if headers:
        for k, v in headers.items():
            cmd.extend(["-H", f"{k}: {v}"])
    if method == "POST":
        cmd.extend(["-X", "POST"])
        if data is not None:
            cmd.extend(["--data-raw", data])
    cmd.append(url)

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=max(5, int(timeout)) + 2,
        env=_clean_subprocess_env(),
    )
    if proc.returncode != 0:
        err_msg = proc.stderr.strip() or f"curl exited {proc.returncode}"
        if proc.returncode == 28:
            raise TimeoutError(err_msg)
        raise RuntimeError(err_msg)
    out = proc.stdout
    marker = "\n__CURL_STATUS__:"
    if marker in out:
        body, code_str = out.rsplit(marker, 1)
        code = int(code_str.strip() or "0")
        if code >= 400 or code == 0:
            raise urllib.error.HTTPError(url, code, f"HTTP {code}", None, None)  # type: ignore[arg-type]
        return body
    return out


def _http_get(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if _CURL_BIN:
        try:
            res = _curl_request(url, method="GET", headers=headers, timeout=timeout)
            if res is not None:
                return res
        except (urllib.error.HTTPError, TimeoutError, subprocess.TimeoutExpired):
            raise
        except Exception as exc:
            logger.warning(f"curl GET fallback to urllib for {url}: {exc}")

    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, **headers},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        raw = resp.read()
        return raw.decode(charset, errors="replace")


def _http_get_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    text = _http_get(url, timeout=timeout)
    return json.loads(text)


def _http_post_json(
    url: str,
    payload: Dict[str, Any],
    extra_headers: Optional[Dict[str, str]] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Any:
    body_str = json.dumps(payload)
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    if _CURL_BIN:
        try:
            res = _curl_request(
                url, method="POST", data=body_str, headers=headers, timeout=timeout
            )
            if res is not None:
                return json.loads(res)
        except urllib.error.HTTPError:
            raise
        except Exception as exc:
            logger.warning(f"curl POST fallback to urllib for {url}: {exc}")

    req = urllib.request.Request(
        url,
        data=body_str.encode("utf-8"),
        headers={"User-Agent": USER_AGENT, **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return json.loads(resp.read().decode(charset, errors="replace"))


def _strip_tags(raw_html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw_html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _clean_game_name(name: str) -> str:
    text = re.sub(r"[™®©]+", "", name or "").strip()
    # Strip ROM region/version tags and file extensions common in EmuDeck / non-Steam shortcuts
    text = re.sub(r"\.(z64|n64|v64|iso|cso|chd|nsp|xci|gba|gbc|nds|3ds|cia|rvz|wbfs|rom)\b", "", text, flags=re.I)
    text = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", text)
    text = re.sub(r"\s+", " ", text).strip(" -:")
    return text


_LOCATION_STOPWORDS = {
    "in",
    "at",
    "on",
    "the",
    "a",
    "an",
    "of",
    "to",
    "for",
    "and",
    "or",
    "exploring",
    "playing",
    "fighting",
    "battling",
    "wandering",
    "roaming",
    "currently",
    "location",
    "area",
    "zone",
    "region",
    "main",
    "menu",
}


def _extract_context_tokens(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", (text or "").lower())
    tokens = [t for t in cleaned.split() if len(t) >= 2 and t not in _LOCATION_STOPWORDS]
    # Deduplicate while preserving order
    seen = set()
    out: List[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _score_context_match(
    title: str,
    description: str,
    url: str,
    context_tokens: List[str],
    raw_hint: str,
) -> Tuple[int, str]:
    if not context_tokens:
        return 0, ""
    title_l = (title or "").lower()
    desc_l = (description or "").lower()
    url_l = (url or "").lower()
    hint_l = (raw_hint or "").strip().lower()

    score = 0
    matched: List[str] = []

    if hint_l and hint_l in title_l:
        score += 60
    elif hint_l and hint_l in url_l:
        score += 45

    for tok in context_tokens:
        if re.search(rf"\b{re.escape(tok)}\b", title_l):
            score += 25
            matched.append(tok)
        elif tok in title_l or tok in url_l:
            score += 15
            matched.append(tok)
        elif tok in desc_l:
            score += 6
            matched.append(tok)

    # Bonus if all context tokens matched in title/url
    if len(context_tokens) > 1 and all(
        tok in title_l or tok in url_l for tok in context_tokens
    ):
        score += 30

    reason = f"Khớp: {' '.join(matched[:4])}" if matched else ""
    return score, reason


def _slugify_game_name(name: str) -> str:
    cleaned = re.sub(r"[™®©:]+", "", name or "").strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned).strip("-")
    return cleaned


class HtmlBlockParser(HTMLParser):
    """Converts IGN Wiki / Steam Guide / MediaWiki HTML into structured blocks."""

    def __init__(self, base_url: str = "") -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.blocks: List[Dict[str, Any]] = []
        self._skip_depth = 0
        self._in_spoiler = False
        self._spoiler_buf: List[str] = []
        self._in_pre = False
        self._pre_buf: List[str] = []
        self._in_quote = False
        self._quote_buf: List[str] = []
        self._heading_level: Optional[int] = None
        self._heading_buf: List[str] = []
        self._list_stack: List[Dict[str, Any]] = []
        self._in_li = False
        self._li_buf: List[str] = []
        self._in_table = False
        self._table_rows: List[List[str]] = []
        self._current_row: List[str] = []
        self._in_cell = False
        self._cell_buf: List[str] = []
        self._para_buf: List[str] = []

    def _flush_paragraph(self) -> None:
        text = "".join(self._para_buf).strip()
        self._para_buf.clear()
        if text:
            lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
            cleaned = "\n".join(ln for ln in lines if ln)
            if cleaned:
                self.blocks.append({"type": "paragraph", "text": cleaned})

    def _append_text(self, text: str) -> None:
        if self._skip_depth > 0:
            return
        if self._in_spoiler:
            self._spoiler_buf.append(text)
        elif self._in_pre:
            self._pre_buf.append(text)
        elif self._heading_level is not None:
            self._heading_buf.append(text)
        elif self._in_cell:
            self._cell_buf.append(text)
        elif self._in_li:
            self._li_buf.append(text)
        elif self._in_quote:
            self._quote_buf.append(text)
        else:
            self._para_buf.append(text)

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag_l = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        cls = attr_map.get("class", "")

        if self._skip_depth > 0:
            if tag_l not in ("br", "img", "hr", "meta", "link", "input"):
                self._skip_depth += 1
            return

        if tag_l in ("script", "style", "noscript") or any(
            skip_cls in cls
            for skip_cls in ("nav_box", "noprint", "mw-editsection", "toc", "header_nav")
        ):
            self._skip_depth = 1
            return

        if tag_l == "br":
            self._append_text("\n")
            return

        if tag_l == "img":
            src = attr_map.get("src", "") or attr_map.get("data-src", "")
            if src:
                if src.startswith("//"):
                    src = "https:" + src
                elif src.startswith("/") and self.base_url:
                    src = urllib.parse.urljoin(self.base_url, src)
                if "steamcommunity.com/economy/emoticon" not in src and "pixel.gif" not in src:
                    self._flush_paragraph()
                    self.blocks.append(
                        {
                            "type": "image",
                            "url": src,
                            "alt": attr_map.get("alt", "").strip(),
                        }
                    )
            return

        if tag_l == "div" and any(h in cls for h in ("bb_h1", "bb_h2", "bb_h3")):
            self._flush_paragraph()
            if "bb_h1" in cls:
                self._heading_level = 1
            elif "bb_h2" in cls:
                self._heading_level = 2
            else:
                self._heading_level = 3
            self._heading_buf.clear()
            return

        if tag_l in ("h1", "h2", "h3", "h4"):
            self._flush_paragraph()
            self._heading_level = min(3, int(tag_l[1]))
            self._heading_buf.clear()
            return

        if "bb_spoiler" in cls:
            self._flush_paragraph()
            self._in_spoiler = True
            self._spoiler_buf.clear()
            return

        if tag_l in ("pre", "code") or "bb_code" in cls:
            if not self._in_pre:
                self._flush_paragraph()
                self._in_pre = True
                self._pre_buf.clear()
            return

        if tag_l == "blockquote" or "bb_blockquote" in cls:
            self._flush_paragraph()
            self._in_quote = True
            self._quote_buf.clear()
            return

        if tag_l in ("ul", "ol"):
            self._flush_paragraph()
            self._list_stack.append({"ordered": tag_l == "ol", "items": []})
            return

        if tag_l == "li":
            self._in_li = True
            self._li_buf.clear()
            return

        if tag_l == "table":
            self._flush_paragraph()
            self._in_table = True
            self._table_rows = []
            return

        if tag_l == "tr" and self._in_table:
            self._current_row = []
            return

        if tag_l in ("td", "th") and self._in_table:
            self._in_cell = True
            self._cell_buf.clear()
            return

        if tag_l == "p":
            self._flush_paragraph()

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()

        if self._skip_depth > 0:
            if tag_l not in ("br", "img", "hr", "meta", "link", "input"):
                self._skip_depth -= 1
            return

        if self._in_spoiler and tag_l == "span":
            txt = re.sub(r"\s+", " ", "".join(self._spoiler_buf)).strip()
            self._spoiler_buf.clear()
            self._in_spoiler = False
            if txt:
                self.blocks.append({"type": "spoiler", "text": txt})
            return

        if self._in_pre and tag_l in ("pre", "code", "div"):
            txt = "".join(self._pre_buf).strip("\n")
            self._pre_buf.clear()
            self._in_pre = False
            if txt.strip():
                self.blocks.append({"type": "code", "text": txt})
            return

        if self._heading_level is not None and tag_l in ("div", "h1", "h2", "h3", "h4"):
            txt = re.sub(r"\s+", " ", "".join(self._heading_buf)).strip()
            level = self._heading_level
            self._heading_buf.clear()
            self._heading_level = None
            if txt:
                self.blocks.append({"type": "heading", "level": level, "text": txt})
            return

        if self._in_quote and tag_l in ("blockquote", "div"):
            txt = re.sub(r"[ \t]+", " ", "".join(self._quote_buf)).strip()
            self._quote_buf.clear()
            self._in_quote = False
            if txt:
                self.blocks.append({"type": "quote", "text": txt})
            return

        if tag_l == "li" and self._in_li:
            txt = re.sub(r"\s+", " ", "".join(self._li_buf)).strip()
            self._li_buf.clear()
            self._in_li = False
            if txt and self._list_stack:
                self._list_stack[-1]["items"].append(txt)
            return

        if tag_l in ("ul", "ol") and self._list_stack:
            lst = self._list_stack.pop()
            if lst["items"]:
                self.blocks.append(
                    {"type": "list", "ordered": lst["ordered"], "items": lst["items"]}
                )
            return

        if tag_l in ("td", "th") and self._in_cell:
            txt = re.sub(r"\s+", " ", "".join(self._cell_buf)).strip()
            self._cell_buf.clear()
            self._in_cell = False
            self._current_row.append(txt)
            return

        if tag_l == "tr" and self._in_table:
            if any(cell for cell in self._current_row):
                self._table_rows.append(self._current_row)
            self._current_row = []
            return

        if tag_l == "table" and self._in_table:
            if self._table_rows:
                self.blocks.append({"type": "table", "rows": self._table_rows})
            self._table_rows = []
            self._in_table = False
            return

        if tag_l in ("p", "div"):
            self._flush_paragraph()

    def handle_data(self, data: str) -> None:
        self._append_text(data)

    def close(self) -> None:
        super().close()
        self._flush_paragraph()


def parse_html_to_blocks(raw_html: str, base_url: str = "") -> List[Dict[str, Any]]:
    parser = HtmlBlockParser(base_url=base_url)
    parser.feed(raw_html)
    parser.close()
    return parser.blocks


def _extract_ign_next_data(html: str) -> Dict[str, Any]:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        raise ValueError("IGN Wiki page data not found")
    data = json.loads(m.group(1))
    return data.get("props", {}).get("pageProps", {}).get("page", {}) or {}


def _search_ign_wikis(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    payload = {
        "query": IGN_UNIFIED_SEARCH_QUERY,
        "variables": {
            "term": query.strip(),
            "types": ["Guides", "Games"],
            "countPerType": limit,
        },
    }
    resp = _http_post_json(
        IGN_GRAPHQL_URL,
        payload,
        extra_headers={"apollographql-client-name": "ign-web"},
        timeout=7,
    )
    sections = resp.get("data", {}).get("unifiedSearch", {}).get("sections", [])
    wikis: List[Dict[str, Any]] = []
    seen_slugs = set()

    # Process Guides section first so actual /wikis/ entries always take precedence over /games/
    ordered_sections = sorted(
        sections, key=lambda s: 0 if s.get("type") == "Guides" else 1
    )
    for sec in ordered_sections:
        sec_type = sec.get("type")
        for item in sec.get("items", []):
            url = (item.get("url") or "").strip()
            title = (item.get("title") or "").strip()
            thumb = (item.get("thumbnailUrl") or "").strip()
            if sec_type == "Guides" and url.startswith("/wikis/"):
                slug = url[len("/wikis/"):].strip("/").split("/")[0]
            elif sec_type == "Games" and url.startswith("/games/"):
                slug = url[len("/games/"):].strip("/").split("/")[0]
            else:
                continue
            if not slug or slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            wikis.append(
                {
                    "slug": slug,
                    "title": title,
                    "image": thumb,
                    "has_guide_match": sec_type == "Guides",
                }
            )
    return wikis


def _search_ign_wikis_broad(query: str, limit: int = 8) -> Tuple[List[Dict[str, Any]], str]:
    """
    Broad IGN Wiki search:
    1. Tries full cleaned query.
    2. If no Guides hit, trims trailing location/boss words or strips common prefixes
       (e.g. 'The Legend of Zelda:') so 'zelda ocarina of time water temple' still
       discovers the Ocarina of Time IGN Wiki and returns 'water temple' as hint!
    """
    cleaned = _clean_game_name(query)
    if not cleaned:
        return [], ""

    # Support direct IGN Wiki URL or slug input
    url_m = re.search(r"ign\.com/wikis/([^/?#\s]+)", query, flags=re.I)
    if url_m:
        slug = url_m.group(1).strip("/")
        return [
            {
                "slug": slug,
                "title": slug.replace("-", " ").title(),
                "image": "",
                "has_guide_match": True,
            }
        ], ""

    results = _search_ign_wikis(cleaned, limit=limit)
    if any(r.get("has_guide_match") for r in results):
        return results, ""

    words = cleaned.split()
    # Try dropping trailing words (e.g. area/boss keywords appended to game name)
    for cut in range(len(words) - 1, 1, -1):
        sub_query = " ".join(words[:cut])
        sub_res = _search_ign_wikis(sub_query, limit=limit)
        if any(r.get("has_guide_match") for r in sub_res):
            remainder = " ".join(words[cut:])
            return sub_res, remainder
        if not results and sub_res:
            results = sub_res

    # Try stripping prefix before ':' or '-' (e.g. 'The Legend of Zelda: Ocarina of Time' -> 'Ocarina of Time')
    if ":" in cleaned or " - " in cleaned:
        tail = re.split(r"[:\-]\s*", cleaned, maxsplit=1)[-1].strip()
        if tail and tail.lower() != cleaned.lower():
            tail_res = _search_ign_wikis(tail, limit=limit)
            if any(r.get("has_guide_match") for r in tail_res):
                return tail_res, ""
            if not results and tail_res:
                results = tail_res

    return results, ""


def _resolve_ign_wiki_candidates(
    game_name: str, explicit_slug: str = ""
) -> List[str]:
    candidates: List[str] = []
    seen = set()

    def add_slug(s: str) -> None:
        s_clean = (s or "").strip().strip("/")
        if s_clean and s_clean not in seen:
            seen.add(s_clean)
            candidates.append(s_clean)

    if explicit_slug.strip():
        add_slug(explicit_slug)

    cleaned_name = _clean_game_name(game_name)
    if cleaned_name:
        norm_target = re.sub(r"[^a-z0-9]+", "", cleaned_name.lower())
        try:
            matches, _ = _search_ign_wikis_broad(cleaned_name, limit=8)
            scored: List[Tuple[int, str]] = []
            for idx, m in enumerate(matches):
                norm_m = re.sub(r"[^a-z0-9]+", "", (m.get("title") or "").lower())
                score = 0
                if m.get("has_guide_match"):
                    score += 200
                if norm_m == norm_target:
                    score += 100
                elif norm_target and (
                    norm_m.startswith(norm_target) or norm_target in norm_m
                ):
                    score += 40
                # Preserve IGN search relevance as tie-breaker
                score -= idx
                scored.append((score, m["slug"]))
            scored.sort(key=lambda x: x[0], reverse=True)
            for _, slug in scored:
                add_slug(slug)
        except Exception:
            pass
        add_slug(_slugify_game_name(cleaned_name))

    return candidates[:5]


def _search_steam_store(cleaned: str) -> List[Dict[str, Any]]:
    try:
        steam_url = (
            "https://store.steampowered.com/api/storesearch/?"
            + urllib.parse.urlencode({"term": cleaned, "l": "english", "cc": "US"})
        )
        data = _http_get_json(steam_url, timeout=7)
        out: List[Dict[str, Any]] = []
        for item in data.get("items", [])[:8]:
            appid = int(item.get("id", 0) or 0)
            name = (item.get("name") or "").strip()
            if appid and name:
                out.append(
                    {
                        "appid": appid,
                        "name": name,
                        "image": item.get("tiny_image")
                        or f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg",
                    }
                )
        return out
    except Exception:
        return []


def _search_strategywiki(cleaned: str) -> List[str]:
    try:
        wiki_url = (
            "https://strategywiki.org/w/api.php?"
            + urllib.parse.urlencode(
                {
                    "action": "query",
                    "list": "search",
                    "srsearch": cleaned,
                    "srlimit": 6,
                    "format": "json",
                }
            )
        )
        wiki_data = _http_get_json(wiki_url, timeout=7)
        titles: List[str] = []
        for item in wiki_data.get("query", {}).get("search", []):
            full_title = (item.get("title") or "").strip()
            if full_title:
                titles.append(full_title.split("/", 1)[0].strip())
        return titles
    except Exception:
        return []


def search_games(query: str) -> List[Dict[str, Any]]:
    """Searches IGN Wikis (broad), Steam Store, and StrategyWiki concurrently."""
    cleaned = _clean_game_name(query)
    if not cleaned:
        return []

    cache_key = cleaned.lower()
    cached = _SEARCH_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < CACHE_TTL_SECONDS:
        return list(cached[1])

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_ign = pool.submit(_search_ign_wikis_broad, query, 10)
        f_steam = pool.submit(_search_steam_store, cleaned)
        f_wiki = pool.submit(_search_strategywiki, cleaned)

        try:
            ign_items, suggested_hint = f_ign.result(timeout=12)
        except Exception as exc:
            logger.warning(f"IGN search failed for {cleaned!r}: {exc}")
            ign_items, suggested_hint = [], ""
        try:
            steam_items = f_steam.result(timeout=10)
        except Exception as exc:
            logger.warning(f"Steam search failed for {cleaned!r}: {exc}")
            steam_items = []
        try:
            wiki_titles = f_wiki.result(timeout=10)
        except Exception as exc:
            logger.warning(f"StrategyWiki search failed for {cleaned!r}: {exc}")
            wiki_titles = []

    results: List[Dict[str, Any]] = []
    by_norm: Dict[str, Dict[str, Any]] = {}

    has_real_ign_wikis = any(w.get("has_guide_match") for w in ign_items)
    for w in ign_items:
        # When IGN already returned verified /wikis/ guides, skip /games/ entries that lack guides
        if has_real_ign_wikis and not w.get("has_guide_match"):
            continue
        norm = re.sub(r"[^a-z0-9]+", "", w["title"].lower())
        entry = {
            "game_key": f"ign:{w['slug']}",
            "source": "ign",
            "appid": 0,
            "wiki_slug": w["slug"] if w.get("has_guide_match") else "",
            "name": w["title"],
            "image": w["image"],
            "suggested_hint": suggested_hint,
        }
        results.append(entry)
        if norm and norm not in by_norm:
            by_norm[norm] = entry

    for item in steam_items:
        appid = item["appid"]
        name = item["name"]
        norm = re.sub(r"[^a-z0-9]+", "", name.lower())
        if norm in by_norm:
            by_norm[norm]["appid"] = appid
            if not by_norm[norm]["image"]:
                by_norm[norm]["image"] = item["image"]
            continue
        entry = {
            "game_key": f"steam:{appid}",
            "source": "steam",
            "appid": appid,
            "wiki_slug": "",
            "name": name,
            "image": item["image"],
            "suggested_hint": suggested_hint,
        }
        results.append(entry)
        by_norm[norm] = entry

    for root_title in wiki_titles:
        norm = re.sub(r"[^a-z0-9]+", "", root_title.lower())
        if norm in by_norm:
            continue
        slug = root_title.replace(" ", "_")
        entry = {
            "game_key": f"wiki:{slug}",
            "source": "strategywiki",
            "appid": 0,
            "wiki_slug": "",
            "name": root_title,
            "image": "",
            "suggested_hint": suggested_hint,
        }
        results.append(entry)
        by_norm[norm] = entry

    final = results[:15]
    if final:
        _SEARCH_CACHE[cache_key] = (time.time(), final)
    return final


def _list_ign_guides(
    wiki_slug: str,
    appid: int,
    game_name: str,
    game_image: str,
    search_text: str = "",
    location_hint: str = "",
) -> List[Dict[str, Any]]:
    if not wiki_slug:
        return []

    page_obj: Dict[str, Any] = {}
    for candidate_path in (f"{wiki_slug}/Walkthrough", wiki_slug):
        try:
            html = _http_get(
                f"https://www.ign.com/wikis/{urllib.parse.quote(candidate_path, safe='/')}",
                timeout=7,
            )
            page_obj = _extract_ign_next_data(html)
            if page_obj.get("navigation") or page_obj.get("page"):
                break
        except Exception:
            continue

    if not page_obj:
        return []

    actual_slug = page_obj.get("wikiSlug") or page_obj.get("slug") or wiki_slug
    resolved_name = page_obj.get("name") or game_name or actual_slug
    wiki_img = ""
    if isinstance(page_obj.get("image"), dict):
        wiki_img = page_obj["image"].get("url") or ""
    thumb = game_image or wiki_img

    guides: List[Dict[str, Any]] = []
    seen_ids = set()
    filter_q = search_text.strip().lower()
    combined_hint = f"{search_text} {location_hint}".strip()
    context_tokens = _extract_context_tokens(combined_hint)

    def add_nav_item(
        label: str, raw_url: str, group_hint: str = "", is_walkthrough_group: bool = False
    ) -> None:
        clean_url = (raw_url or "").strip().lstrip("/")
        if not clean_url:
            return
        if clean_url.startswith(f"wikis/{actual_slug}/"):
            clean_url = clean_url[len(f"wikis/{actual_slug}/"):]
        guide_id = f"{actual_slug}/{clean_url}"
        if guide_id in seen_ids:
            return
        display_title = (
            f"{group_hint}: {label}"
            if group_hint and group_hint.lower() not in label.lower()
            else label
        )
        score, reason = _score_context_match(
            display_title, "", clean_url, context_tokens, combined_hint
        )
        # If user typed an explicit manual filter, keep matching items + fallback if none match
        seen_ids.add(guide_id)
        base_priority = 10 if is_walkthrough_group else 0
        if clean_url.lower() == "walkthrough":
            base_priority += 15
        guides.append(
            {
                "guide_id": guide_id,
                "source": "ign",
                "title": display_title,
                "author": "IGN Wikis",
                "description": f"IGN {resolved_name} Guide",
                "rating_stars": 5,
                "url": f"https://www.ign.com/wikis/{guide_id}",
                "appid": appid,
                "game_name": resolved_name,
                "game_image": thumb,
                "match_score": score + base_priority,
                "match_reason": reason,
            }
        )

    nav_list = page_obj.get("navigation") or []
    walkthrough_nodes = [
        n for n in nav_list if "walkthrough" in (n.get("label") or "").lower()
    ]
    other_nodes = [
        n for n in nav_list if "walkthrough" not in (n.get("label") or "").lower()
    ]

    for is_wt, nodes in ((True, walkthrough_nodes), (False, other_nodes)):
        for node in nodes:
            label = (node.get("label") or "").strip()
            url = (node.get("url") or "").strip()
            subnav = node.get("subnav") or []
            if url:
                add_nav_item(label, url, is_walkthrough_group=is_wt)
            for sub in subnav:
                sub_label = (sub.get("label") or "").strip()
                sub_url = (sub.get("url") or "").strip()
                if sub_url:
                    add_nav_item(
                        sub_label, sub_url, group_hint=label, is_walkthrough_group=is_wt
                    )

    if not guides and page_obj.get("page"):
        canonical = (page_obj.get("canonical") or f"/wikis/{actual_slug}").lstrip("/")
        if canonical.startswith("wikis/"):
            canonical = canonical[len("wikis/"):]
        guides.append(
            {
                "guide_id": canonical,
                "source": "ign",
                "title": page_obj.get("page", {}).get("title") or f"{resolved_name} Wiki",
                "author": "IGN Wikis",
                "description": page_obj.get("description") or "",
                "rating_stars": 5,
                "url": f"https://www.ign.com/wikis/{canonical}",
                "appid": appid,
                "game_name": resolved_name,
                "game_image": thumb,
                "match_score": 10,
                "match_reason": "",
            }
        )

    if filter_q:
        exact_filtered = [
            g
            for g in guides
            if filter_q in g["title"].lower()
            or filter_q in g["guide_id"].lower()
            or g["match_score"] >= 25
        ]
        if exact_filtered:
            guides = exact_filtered

    if context_tokens:
        guides.sort(key=lambda g: g.get("match_score", 0), reverse=True)

    return guides[:35]


def _parse_steam_guides_html(
    html: str, appid: int, game_name: str, game_image: str
) -> List[Dict[str, Any]]:
    guides: List[Dict[str, Any]] = []
    blocks = re.split(r'<div class="workshopItem"\s*>', html)[1:]
    for block in blocks:
        id_match = re.search(r'data-publishedfileid="(\d+)"', block)
        if not id_match:
            continue
        guide_id = id_match.group(1)

        title_match = re.search(
            r'class="workshopItemTitle[^"]*">(.*?)</div>', block, re.S
        )
        title = _strip_tags(title_match.group(1)) if title_match else f"Guide #{guide_id}"

        author_match = re.search(
            r'class="workshopItemAuthorName[^"]*">(.*?)</div>', block, re.S
        )
        author = _strip_tags(author_match.group(1)) if author_match else "Steam Author"

        desc_match = re.search(
            r'class="workshopItemShortDesc[^"]*">(.*?)</div>', block, re.S
        )
        short_desc = _strip_tags(desc_match.group(1)) if desc_match else ""

        star_match = re.search(r'(\d)-star\.png', block)
        stars = int(star_match.group(1)) if star_match else 0

        thumb_match = re.search(r'<img class="workshopItemPreviewImage[^"]*" src="([^"]+)"', block)
        thumb = thumb_match.group(1) if thumb_match else game_image

        guides.append(
            {
                "guide_id": guide_id,
                "source": "steam",
                "title": title,
                "author": author,
                "description": short_desc,
                "rating_stars": stars,
                "url": f"https://steamcommunity.com/sharedfiles/filedetails/?id={guide_id}",
                "appid": appid,
                "game_name": game_name,
                "game_image": thumb or game_image,
            }
        )
    return guides


def _fetch_ign_guides_pipeline(
    appid: int,
    game_name: str,
    game_image: str,
    search_text: str,
    wiki_slug: str,
    location_hint: str = "",
) -> List[Dict[str, Any]]:
    candidates = _resolve_ign_wiki_candidates(game_name, wiki_slug)
    if not candidates:
        return []

    # If user explicitly picked a known wiki slug, try it first and fall back to others only if empty
    if wiki_slug.strip():
        first = _list_ign_guides(
            wiki_slug=candidates[0],
            appid=appid,
            game_name=game_name,
            game_image=game_image,
            search_text=search_text,
            location_hint=location_hint,
        )
        if first:
            return first
        candidates = candidates[1:]

    # Try top candidates concurrently (up to 3) so alternate editions like 3D / Remake are never missed
    top_candidates = candidates[:3]
    if not top_candidates:
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(top_candidates)) as pool:
        futures = [
            pool.submit(
                _list_ign_guides,
                slug,
                appid,
                game_name,
                game_image,
                search_text,
                location_hint,
            )
            for slug in top_candidates
        ]
        for fut in futures:
            try:
                res = fut.result(timeout=10)
                if res:
                    return res
            except Exception:
                continue
    return []


def _fetch_steam_guides_pipeline(
    appid: int,
    game_name: str,
    game_image: str,
    search_text: str,
    walkthrough_only: bool,
    english_only: bool,
    location_hint: str = "",
) -> Tuple[List[Dict[str, Any]], bool]:
    if not appid or appid <= 0:
        return [], False

    combined_hint = f"{search_text} {location_hint}".strip()
    context_tokens = _extract_context_tokens(combined_hint)
    effective_query = search_text.strip() or " ".join(context_tokens[:3])

    base = f"https://steamcommunity.com/app/{appid}/guides/"
    params: List[Tuple[str, str]] = [
        ("browsesort", "toprated"),
        ("browsefilter", "toprated"),
        ("p", "1"),
    ]
    if effective_query:
        params.append(("searchtext", effective_query))
    if english_only:
        params.append(("requiredtags[]", "English"))
    if walkthrough_only:
        params.append(("requiredtags[]", "Walkthroughs"))

    steam_guides: List[Dict[str, Any]] = []
    used_fallback = False
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        html = _http_get(url, timeout=7)
        steam_guides = _parse_steam_guides_html(html, appid, game_name, game_image)
    except Exception:
        steam_guides = []

    # If location query + Walkthroughs tag returned nothing, retry without searchtext or tag
    if not steam_guides and effective_query:
        no_query_params = [p for p in params if p[0] != "searchtext"]
        try:
            html = _http_get(base + "?" + urllib.parse.urlencode(no_query_params), timeout=7)
            steam_guides = _parse_steam_guides_html(html, appid, game_name, game_image)
        except Exception:
            pass

    if not steam_guides and walkthrough_only:
        fallback_params = [
            p
            for p in params
            if p != ("requiredtags[]", "Walkthroughs") and p[0] != "searchtext"
        ]
        try:
            html = _http_get(base + "?" + urllib.parse.urlencode(fallback_params), timeout=7)
            steam_guides = _parse_steam_guides_html(html, appid, game_name, game_image)
            if steam_guides:
                used_fallback = True
        except Exception:
            pass

    for g in steam_guides:
        score, reason = _score_context_match(
            g["title"], g.get("description", ""), g["url"], context_tokens, combined_hint
        )
        g["match_score"] = score
        g["match_reason"] = reason

    if context_tokens:
        steam_guides.sort(
            key=lambda g: (g.get("match_score", 0), g.get("rating_stars", 0)),
            reverse=True,
        )

    return steam_guides[:12], used_fallback


def _fetch_strategywiki_guides_pipeline(
    appid: int,
    game_name: str,
    game_image: str,
    search_text: str,
    location_hint: str = "",
) -> List[Dict[str, Any]]:
    cleaned = _clean_game_name(game_name)
    if not cleaned:
        return []
    combined_hint = f"{search_text} {location_hint}".strip()
    context_tokens = _extract_context_tokens(combined_hint)
    try:
        extra = search_text.strip() or " ".join(context_tokens[:3])
        query_str = f"{cleaned} {extra}".strip() if extra else f"{cleaned} Walkthrough"
        wiki_url = (
            "https://strategywiki.org/w/api.php?"
            + urllib.parse.urlencode(
                {
                    "action": "query",
                    "list": "search",
                    "srsearch": query_str,
                    "srlimit": 6,
                    "format": "json",
                }
            )
        )
        wiki_data = _http_get_json(wiki_url, timeout=6)
        out: List[Dict[str, Any]] = []
        for item in wiki_data.get("query", {}).get("search", []):
            page_title = (item.get("title") or "").strip()
            if not page_title:
                continue
            snippet = _strip_tags(item.get("snippet") or "")
            score, reason = _score_context_match(
                page_title, snippet, page_title, context_tokens, combined_hint
            )
            out.append(
                {
                    "guide_id": page_title.replace(" ", "_"),
                    "source": "strategywiki",
                    "title": page_title,
                    "author": "StrategyWiki",
                    "description": snippet,
                    "rating_stars": 0,
                    "url": "https://strategywiki.org/wiki/"
                    + urllib.parse.quote(page_title.replace(" ", "_")),
                    "appid": appid,
                    "game_name": game_name,
                    "game_image": game_image,
                    "match_score": score,
                    "match_reason": reason,
                }
            )
        return out
    except Exception:
        return []


def list_guides_for_game(
    appid: int = 0,
    game_name: str = "",
    game_image: str = "",
    search_text: str = "",
    walkthrough_only: bool = True,
    english_only: bool = True,
    wiki_slug: str = "",
    location_hint: str = "",
) -> Dict[str, Any]:
    """Lists top walkthroughs concurrently, ranked by active game part / location."""
    cache_key = (
        int(appid or 0),
        _clean_game_name(game_name).lower(),
        search_text.strip().lower(),
        bool(walkthrough_only),
        bool(english_only),
        wiki_slug.strip().lower(),
        location_hint.strip().lower(),
    )
    cached = _LIST_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < CACHE_TTL_SECONDS:
        return dict(cached[1])

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_ign = pool.submit(
            _fetch_ign_guides_pipeline,
            appid,
            game_name,
            game_image,
            search_text,
            wiki_slug,
            location_hint,
        )
        f_steam = pool.submit(
            _fetch_steam_guides_pipeline,
            appid,
            game_name,
            game_image,
            search_text,
            walkthrough_only,
            english_only,
            location_hint,
        )
        f_wiki = pool.submit(
            _fetch_strategywiki_guides_pipeline,
            appid,
            game_name,
            game_image,
            search_text,
            location_hint,
        )

        errors: List[str] = []
        try:
            ign_guides = f_ign.result(timeout=14)
        except Exception as exc:
            logger.warning(f"IGN list_guides failed for {game_name!r}: {exc}")
            errors.append(f"IGN: {exc}")
            ign_guides = []
        try:
            steam_guides, used_fallback = f_steam.result(timeout=14)
        except Exception as exc:
            logger.warning(f"Steam list_guides failed for {game_name!r}: {exc}")
            errors.append(f"Steam: {exc}")
            steam_guides, used_fallback = [], False

        guides: List[Dict[str, Any]] = list(ign_guides) + list(steam_guides)
        if len(guides) < 6 or location_hint.strip() or search_text.strip():
            try:
                guides.extend(f_wiki.result(timeout=8))
            except Exception as exc:
                logger.warning(f"StrategyWiki list_guides failed for {game_name!r}: {exc}")
                errors.append(f"StrategyWiki: {exc}")

    # Prioritize IGN Wikis first; when context is present, boost location matches while keeping IGN ahead of ties
    has_context = bool(search_text.strip() or location_hint.strip())
    if has_context:
        guides.sort(
            key=lambda g: (
                1 if g.get("match_reason") else 0,
                1 if g["source"] == "ign" else 0,
                g.get("match_score", 0),
                g.get("rating_stars", 0),
            ),
            reverse=True,
        )
    else:
        guides.sort(
            key=lambda g: (
                2 if g["source"] == "ign" else (1 if g["source"] == "steam" else 0),
                g.get("match_score", 0),
                g.get("rating_stars", 0),
            ),
            reverse=True,
        )

    res = {
        "guides": guides,
        "fallback_all_guides": used_fallback,
        "errors": errors,
    }
    if guides:
        _LIST_CACHE[cache_key] = (time.time(), res)
    return res


def _parse_ign_html(guide_id: str, html: str) -> Dict[str, Any]:
    clean_id = urllib.parse.unquote(guide_id).strip().lstrip("/")
    if clean_id.startswith("wikis/"):
        clean_id = clean_id[len("wikis/"):]
    url = f"https://www.ign.com/wikis/{urllib.parse.quote(clean_id, safe='/')}"
    page_obj = _extract_ign_next_data(html)

    actual_slug = page_obj.get("wikiSlug") or page_obj.get("slug") or clean_id.split("/", 1)[0]
    game_name = (page_obj.get("name") or actual_slug).strip()
    wiki_page = page_obj.get("page") or {}
    page_title = _strip_tags(
        wiki_page.get("displayTitle") or wiki_page.get("title") or page_obj.get("title") or clean_id
    )

    entities = wiki_page.get("htmlEntities") or []
    sections: List[Dict[str, Any]] = []
    current_id = "overview"
    current_title = "Overview"
    current_html_parts: List[str] = []

    def flush_section() -> None:
        if not current_html_parts and not sections:
            return
        combined = "\n".join(current_html_parts)
        blocks = parse_html_to_blocks(combined, base_url="https://www.ign.com")
        if blocks or (current_title and current_title != "Overview"):
            sections.append(
                {
                    "id": current_id,
                    "title": current_title,
                    "blocks": blocks,
                }
            )

    for ent in entities:
        vals = ent.get("values") or {}
        tag = (vals.get("tag") or "").lower()
        ent_html = vals.get("html") or ""
        if not ent_html:
            continue
        if tag in ("h1", "h2"):
            flush_section()
            current_html_parts = []
            sec_title = _strip_tags(ent_html)
            id_m = re.search(r'id="([^"]+)"', ent_html)
            current_id = id_m.group(1) if id_m else f"sec-{len(sections) + 1}"
            current_title = sec_title or f"Part {len(sections) + 1}"
        else:
            current_html_parts.append(ent_html)

    flush_section()

    if not sections and page_obj.get("description"):
        sections.append(
            {
                "id": "overview",
                "title": page_title,
                "blocks": [{"type": "paragraph", "text": page_obj["description"]}],
            }
        )

    related_pages: List[Dict[str, str]] = []
    seen_rel = {clean_id}

    for key in ("nextPage", "prevPage"):
        np = wiki_page.get(key)
        if isinstance(np, dict) and np.get("url"):
            rel_url = np["url"].lstrip("/")
            if rel_url.startswith(f"wikis/{actual_slug}/"):
                rel_url = rel_url[len(f"wikis/{actual_slug}/"):]
            rel_id = f"{actual_slug}/{rel_url}" if not rel_url.startswith(f"{actual_slug}/") else rel_url
            if rel_id not in seen_rel:
                seen_rel.add(rel_id)
                prefix = "Trang tiếp: " if key == "nextPage" else "Trang trước: "
                related_pages.append(
                    {"guide_id": rel_id, "title": f"{prefix}{np.get('title') or rel_url}"}
                )

    for nav in page_obj.get("navigation") or []:
        for item in [nav] + (nav.get("subnav") or []):
            raw_u = (item.get("url") or "").strip().lstrip("/")
            if not raw_u:
                continue
            if raw_u.startswith(f"wikis/{actual_slug}/"):
                raw_u = raw_u[len(f"wikis/{actual_slug}/"):]
            rel_id = f"{actual_slug}/{raw_u}"
            if rel_id not in seen_rel:
                seen_rel.add(rel_id)
                related_pages.append(
                    {"guide_id": rel_id, "title": (item.get("label") or raw_u).strip()}
                )

    return {
        "guide_id": clean_id,
        "source": "ign",
        "title": page_title,
        "author": "IGN Wikis",
        "appid": 0,
        "game_name": game_name,
        "url": url,
        "sections": sections,
        "related_pages": related_pages[:30],
    }


def _fetch_ign_guide(guide_id: str) -> Dict[str, Any]:
    clean_id = urllib.parse.unquote(guide_id).strip().lstrip("/")
    if clean_id.startswith("wikis/"):
        clean_id = clean_id[len("wikis/"):]
    url = f"https://www.ign.com/wikis/{urllib.parse.quote(clean_id, safe='/')}"
    html = _http_get(url, timeout=9)
    return _parse_ign_html(clean_id, html)


def _parse_steam_guide_html(guide_id: str, html: str) -> Dict[str, Any]:
    url = f"https://steamcommunity.com/sharedfiles/filedetails/?id={urllib.parse.quote(guide_id)}"

    title_m = re.search(r'<div class="workshopItemTitle">(.*?)</div>', html, re.S)
    title = _strip_tags(title_m.group(1)) if title_m else f"Steam Guide #{guide_id}"

    author_m = re.search(
        r'<div class="friendBlockContent">\s*([^<\n]+)', html, re.S
    )
    author = _strip_tags(author_m.group(1)) if author_m else "Steam Author"

    app_m = re.search(
        r'steamcommunity\.com/app/(\d+)[^>]*>([^<]+)</a>', html, re.S
    )
    appid = int(app_m.group(1)) if app_m else 0
    game_name = _strip_tags(app_m.group(2)) if app_m else ""

    sections: List[Dict[str, Any]] = []
    sec_pattern = re.compile(
        r'<div class="subSection detailBox" id="([^"]+)">\s*'
        r'<div class="subSectionTitle">(.*?)</div>\s*'
        r'<div class="subSectionDesc"[^>]*>(.*?)</div>\s*'
        r'<div style="clear: both',
        re.S,
    )
    for m in sec_pattern.finditer(html):
        sec_id = m.group(1).strip()
        sec_title = _strip_tags(m.group(2)) or f"Section {len(sections) + 1}"
        sec_html = m.group(3)
        blocks = parse_html_to_blocks(sec_html, base_url="https://steamcommunity.com")
        sections.append(
            {
                "id": sec_id,
                "title": sec_title,
                "blocks": blocks,
            }
        )

    if not sections:
        desc_m = re.search(
            r'<div class="workshopItemDescription"[^>]*>(.*?)</div>\s*<div style="clear: both',
            html,
            re.S,
        )
        if desc_m:
            blocks = parse_html_to_blocks(desc_m.group(1), base_url="https://steamcommunity.com")
            sections.append({"id": "overview", "title": "Overview", "blocks": blocks})

    return {
        "guide_id": guide_id,
        "source": "steam",
        "title": title,
        "author": author,
        "appid": appid,
        "game_name": game_name,
        "url": url,
        "sections": sections,
        "related_pages": [],
    }


def _fetch_steam_guide(guide_id: str) -> Dict[str, Any]:
    url = f"https://steamcommunity.com/sharedfiles/filedetails/?id={urllib.parse.quote(guide_id)}"
    html = _http_get(url, timeout=9)
    return _parse_steam_guide_html(guide_id, html)


def _fetch_strategywiki_guide(page_slug: str) -> Dict[str, Any]:
    page_name = urllib.parse.unquote(page_slug).replace(" ", "_")
    api_url = (
        "https://strategywiki.org/w/api.php?"
        + urllib.parse.urlencode(
            {
                "action": "parse",
                "page": page_name,
                "prop": "text|sections|displaytitle",
                "format": "json",
                "redirects": 1,
            }
        )
    )
    data = _http_get_json(api_url)
    if "error" in data:
        raise ValueError(data["error"].get("info", "StrategyWiki page not found"))

    parse_obj = data.get("parse", {})
    title = _strip_tags(parse_obj.get("displaytitle") or parse_obj.get("title") or page_name)
    raw_html = parse_obj.get("text", {}).get("*", "")
    root_game = title.split("/", 1)[0].strip()

    related_pages: List[Dict[str, str]] = []
    seen_slugs = {page_name}
    root_prefix = "/wiki/" + urllib.parse.quote(root_game.replace(" ", "_")) + "/"
    for link_m in re.finditer(r'<a[^>]+href="(/wiki/[^"#]+)"[^>]*>(.*?)</a>', raw_html, re.S):
        href = link_m.group(1)
        if href.startswith(root_prefix):
            slug = urllib.parse.unquote(href[len("/wiki/"):])
            if slug not in seen_slugs and not slug.endswith(("/Edit", "/edit")):
                seen_slugs.add(slug)
                label = _strip_tags(link_m.group(2)) or slug.split("/")[-1].replace("_", " ")
                related_pages.append({"guide_id": slug, "title": label})

    sections: List[Dict[str, Any]] = []
    parts = re.split(r'(<h2[^>]*>.*?</h2>)', raw_html, flags=re.S)
    intro_blocks = parse_html_to_blocks(parts[0], base_url="https://strategywiki.org")
    if intro_blocks:
        sections.append({"id": "intro", "title": "Overview", "blocks": intro_blocks})

    for idx in range(1, len(parts), 2):
        h2_html = parts[idx]
        body_html = parts[idx + 1] if idx + 1 < len(parts) else ""
        sec_title = _strip_tags(re.sub(r'<span class="mw-editsection".*?</span>', "", h2_html, flags=re.S))
        id_m = re.search(r'id="([^"]+)"', h2_html)
        sec_id = id_m.group(1) if id_m else f"sec-{idx}"
        blocks = parse_html_to_blocks(body_html, base_url="https://strategywiki.org")
        if blocks or sec_title:
            sections.append(
                {
                    "id": sec_id,
                    "title": sec_title or f"Part {len(sections) + 1}",
                    "blocks": blocks,
                }
            )

    if not sections:
        sections.append(
            {
                "id": "content",
                "title": title,
                "blocks": parse_html_to_blocks(raw_html, base_url="https://strategywiki.org"),
            }
        )

    return {
        "guide_id": page_name,
        "source": "strategywiki",
        "title": title,
        "author": "StrategyWiki",
        "appid": 0,
        "game_name": root_game,
        "url": "https://strategywiki.org/wiki/" + urllib.parse.quote(page_name),
        "sections": sections,
        "related_pages": related_pages[:30],
    }


def _domain_from_url(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _guide_id_for_url(url: str) -> Tuple[str, str]:
    """Maps any trusted URL to (source, guide_id) so specialized parsers run when available."""
    ign_m = re.search(r"ign\.com/wikis/([^?#]+)", url, flags=re.I)
    if ign_m:
        return "ign", ign_m.group(1).strip("/")

    steam_m = re.search(r"steamcommunity\.com/sharedfiles/filedetails/\?id=(\d+)", url, flags=re.I)
    if steam_m:
        return "steam", steam_m.group(1)

    wiki_m = re.search(r"strategywiki\.org/wiki/([^?#]+)", url, flags=re.I)
    if wiki_m:
        return "strategywiki", urllib.parse.unquote(wiki_m.group(1)).strip("/")

    return "web", url


def _search_powerpyx(query: str, game_name: str = "") -> List[Dict[str, Any]]:
    cleaned = _clean_game_name(query)
    if not cleaned:
        return []
    url = "https://www.powerpyx.com/?" + urllib.parse.urlencode({"s": cleaned})
    html = _http_get(url, timeout=8)
    items = re.findall(
        r'<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        html,
        re.S,
    )
    out: List[Dict[str, Any]] = []
    for link, raw_title in items[:8]:
        title = _strip_tags(raw_title)
        if not title:
            continue
        out.append(
            {
                "guide_id": link,
                "source": "web",
                "title": title,
                "author": "PowerPyx",
                "description": "PowerPyx Walkthrough & Trophy Guide",
                "rating_stars": 5,
                "url": link,
                "appid": 0,
                "game_name": game_name or cleaned,
                "game_image": "",
                "match_score": 30,
                "match_reason": "",
            }
        )
    return out


def _search_pcgamer(query: str, game_name: str = "") -> List[Dict[str, Any]]:
    cleaned = _clean_game_name(query)
    if not cleaned:
        return []
    q_full = f"{cleaned} guide" if "guide" not in cleaned.lower() and "walkthrough" not in cleaned.lower() else cleaned
    url = "https://www.pcgamer.com/search/?" + urllib.parse.urlencode({"searchTerm": q_full})
    html = _http_get(url, timeout=8)
    items = re.findall(
        r'<a[^>]+href="(https://www\.pcgamer\.com/[^"]+)"[^>]+class="article-link"[^>]+aria-label="([^"]+)"',
        html,
        re.S,
    )
    if not items:
        items = re.findall(
            r'<a[^>]+class="article-link"[^>]+href="(https://www\.pcgamer\.com/[^"]+)"[^>]+aria-label="([^"]+)"',
            html,
            re.S,
        )
    out: List[Dict[str, Any]] = []
    seen = set()
    for link, raw_title in items:
        if link in seen:
            continue
        title = html_lib.unescape(raw_title).strip()
        if not title:
            continue
        # Prefer guides/walkthroughs/quest articles over general news
        is_guide_like = any(
            kw in link.lower() or kw in title.lower()
            for kw in ("guide", "walkthrough", "quest", "boss", "location", "build", "how-to", "tips")
        )
        if not is_guide_like and len(out) >= 3:
            continue
        seen.add(link)
        out.append(
            {
                "guide_id": link,
                "source": "web",
                "title": title,
                "author": "PC Gamer",
                "description": "PC Gamer Walkthrough & Guide",
                "rating_stars": 5 if is_guide_like else 3,
                "url": link,
                "appid": 0,
                "game_name": game_name or cleaned,
                "game_image": "",
                "match_score": 28 if is_guide_like else 10,
                "match_reason": "",
            }
        )
        if len(out) >= 6:
            break
    return out


def _search_game8(query: str, game_name: str = "") -> List[Dict[str, Any]]:
    cleaned = _clean_game_name(query)
    if not cleaned:
        return []
    url = "https://game8.co/search?" + urllib.parse.urlencode({"q": cleaned})
    html = _http_get(url, timeout=8)
    tokens = _extract_context_tokens(cleaned)
    out: List[Dict[str, Any]] = []
    seen = set()
    for m in re.finditer(
        r'href="(https://game8\.co/games/[^"]+|/games/[^"]+)"[^>]*>(.*?)</a>',
        html,
        re.S,
    ):
        raw_href = m.group(1)
        if ":id" in raw_href:
            continue
        link = (
            raw_href
            if raw_href.startswith("http")
            else f"https://game8.co{raw_href}"
        )
        if link in seen:
            continue
        title = _strip_tags(m.group(2))
        if not title or len(title) < 3:
            continue
        if tokens and not any(t in title.lower() or t in link.lower() for t in tokens[:2]):
            continue
        seen.add(link)
        out.append(
            {
                "guide_id": link,
                "source": "web",
                "title": title,
                "author": "Game8",
                "description": "Game8 Walkthrough & Guides",
                "rating_stars": 4,
                "url": link,
                "appid": 0,
                "game_name": game_name or cleaned,
                "game_image": "",
                "match_score": 25,
                "match_reason": "",
            }
        )
        if len(out) >= 6:
            break
    return out


def search_walkthroughs(
    query: str,
    appid: int = 0,
    game_name: str = "",
    location_hint: str = "",
    walkthrough_only: bool = True,
    english_only: bool = True,
) -> Dict[str, Any]:
    """
    One-step unified walkthrough search across:
    1. IGN Wikis (with automatic broad & location-aware matching)
    2. PowerPyx & Game8 (direct walkthrough articles)
    3. Steam Community Guides (when appid is known or resolved via Steam Store)
    4. StrategyWiki
    """
    raw_q = (query or game_name or "").strip()
    if not raw_q:
        return {"guides": [], "errors": []}

    cleaned_q = _clean_game_name(raw_q)
    cache_key = (
        cleaned_q.lower(),
        int(appid or 0),
        _clean_game_name(game_name).lower(),
        location_hint.strip().lower(),
        bool(walkthrough_only),
        bool(english_only),
    )
    cached = _UNIFIED_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < CACHE_TTL_SECONDS:
        return dict(cached[1])

    # Direct URL support (e.g. user pastes an IGN/PowerPyx/Game8 URL directly)
    if raw_q.startswith("http://") or raw_q.startswith("https://"):
        src, gid = _guide_id_for_url(raw_q)
        return {
            "guides": [
                {
                    "guide_id": gid,
                    "source": src,
                    "title": raw_q,
                    "author": _domain_from_url(raw_q) or "Web",
                    "description": "Direct URL",
                    "rating_stars": 5,
                    "url": raw_q,
                    "appid": appid,
                    "game_name": game_name or cleaned_q,
                    "game_image": "",
                    "match_score": 200,
                    "match_reason": "URL trực tiếp",
                }
            ],
            "errors": [],
        }

    # Resolve broad IGN game + trailing location/boss hint if needed
    effective_game = _clean_game_name(game_name or raw_q)
    effective_hint = location_hint.strip()
    ign_items, extracted_hint = _search_ign_wikis_broad(raw_q, limit=6)
    if extracted_hint and not effective_hint:
        effective_hint = extracted_hint

    # Pick top IGN wiki slug if matched
    top_ign_slugs = [w["slug"] for w in ign_items if w.get("has_guide_match")][:2]

    # Resolve Steam AppID quickly if not provided
    steam_appid = int(appid or 0)
    steam_game_name = effective_game
    steam_image = ""

    def run_steam_pipeline() -> List[Dict[str, Any]]:
        nonlocal steam_appid, steam_game_name, steam_image
        if steam_appid <= 0:
            steam_hits = _search_steam_store(effective_game)
            if steam_hits:
                steam_appid = steam_hits[0]["appid"]
                steam_game_name = steam_hits[0]["name"]
                steam_image = steam_hits[0]["image"]
        if steam_appid > 0:
            sg, _ = _fetch_steam_guides_pipeline(
                steam_appid,
                steam_game_name,
                steam_image,
                effective_hint,
                walkthrough_only,
                english_only,
                effective_hint,
            )
            return sg
        return []

    def run_ign_pipeline() -> List[Dict[str, Any]]:
        if top_ign_slugs:
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(top_ign_slugs)) as subpool:
                futs = [
                    subpool.submit(
                        _list_ign_guides,
                        slug,
                        steam_appid,
                        effective_game,
                        "",
                        effective_hint,
                        effective_hint,
                    )
                    for slug in top_ign_slugs
                ]
                merged: List[Dict[str, Any]] = []
                for f in futs:
                    try:
                        merged.extend(f.result(timeout=10)[:15])
                    except Exception:
                        continue
                if merged:
                    return merged
        return _fetch_ign_guides_pipeline(
            steam_appid, effective_game, "", effective_hint, "", effective_hint
        )

    errors: List[str] = []
    all_guides: List[Dict[str, Any]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        f_ign = pool.submit(run_ign_pipeline)
        f_pp = pool.submit(_search_powerpyx, raw_q, effective_game)
        f_g8 = pool.submit(_search_game8, raw_q, effective_game)
        f_pcg = pool.submit(_search_pcgamer, raw_q, effective_game)
        f_steam = pool.submit(run_steam_pipeline)
        f_wiki = pool.submit(
            _fetch_strategywiki_guides_pipeline,
            steam_appid,
            effective_game,
            "",
            effective_hint,
            effective_hint,
        )

        for label, fut in (
            ("IGN", f_ign),
            ("PowerPyx", f_pp),
            ("Game8", f_g8),
            ("PCGamer", f_pcg),
            ("Steam", f_steam),
            ("StrategyWiki", f_wiki),
        ):
            try:
                all_guides.extend(fut.result(timeout=12))
            except Exception as exc:
                logger.warning(f"{label} search failed for {raw_q!r}: {exc}")
                errors.append(f"{label}: {exc}")

    # Deduplicate by (source, guide_id) or URL and rank by location/context match + trusted source
    context_tokens = _extract_context_tokens(f"{raw_q} {effective_hint}")
    deduped: List[Dict[str, Any]] = []
    seen_urls = set()
    for g in all_guides:
        u = (g.get("url") or f"{g['source']}:{g['guide_id']}").strip()
        if u in seen_urls:
            continue
        seen_urls.add(u)
        sc, reason = _score_context_match(
            g["title"],
            g.get("description", ""),
            u,
            context_tokens,
            effective_hint or raw_q,
        )
        if reason and not g.get("match_reason"):
            g["match_reason"] = reason
        g["match_score"] = max(g.get("match_score", 0), sc)
        deduped.append(g)

    source_weight = {
        "google": 6,
        "ign": 5,
        "web": 4,
        "steam": 3,
        "strategywiki": 2,
    }
    deduped.sort(
        key=lambda g: (
            1 if g.get("match_reason") else 0,
            g.get("match_score", 0),
            source_weight.get(g["source"], 1),
            g.get("rating_stars", 0),
        ),
        reverse=True,
    )

    result = {
        "guides": deduped[:40],
        "errors": errors,
        "resolved_hint": effective_hint,
    }
    if deduped:
        _UNIFIED_CACHE[cache_key] = (time.time(), result)
    return result


def _extract_balanced_tag(html: str, start_tag_pattern: str, tag_name: str = "div") -> str:
    """Extracts the full inner HTML of a balanced container tag (e.g. <div class="entry-content">)."""
    m = re.search(start_tag_pattern, html, re.S | re.I)
    if not m:
        return ""
    start_pos = m.end()
    depth = 1
    token_re = re.compile(rf"<(/?){tag_name}\b[^>]*>", re.I)
    for tok in token_re.finditer(html, start_pos):
        if tok.group(1) == "/":
            depth -= 1
            if depth == 0:
                return html[start_pos:tok.start()]
        else:
            if not tok.group(0).endswith("/>"):
                depth += 1
    return html[start_pos:]


def _search_page_fallback_guide(url: str) -> Optional[Dict[str, Any]]:
    """Turns CSR search URLs (IGN Search / Google Search) into clickable walkthrough results."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    qs = urllib.parse.parse_qs(parsed.query)
    q = (qs.get("q") or [""])[0].strip()
    if not q:
        return None
    if not (
        ("ign.com" in host and parsed.path.startswith("/search"))
        or ("google." in host and parsed.path.startswith("/search"))
    ):
        return None

    res = search_walkthroughs(query=q)
    guides = res.get("guides") or []
    if not guides:
        return None

    items = [
        f"{g.get('title', '')} ({str(g.get('source', '')).upper()})"
        for g in guides[:12]
        if g.get("title")
    ]
    related = [
        {"guide_id": g.get("url") or g.get("guide_id", ""), "title": g.get("title", "")}
        for g in guides[:12]
        if (g.get("url") or g.get("guide_id")) and g.get("title")
    ]
    return {
        "guide_id": url,
        "source": "web",
        "title": f"Kết quả tìm: {q}",
        "author": "IGN / Web Search",
        "appid": 0,
        "game_name": q,
        "url": url,
        "sections": [
            {
                "id": "search-results",
                "title": f"Các hướng dẫn tìm thấy cho \"{q}\"",
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "Chọn một mục bên dưới để mở trực tiếp trang hướng dẫn (hoặc bấm Mở Web Live để xem trang gốc):",
                    },
                    {"type": "list", "ordered": True, "items": items},
                ],
            }
        ],
        "related_pages": related,
    }


def _parse_web_guide_html(url: str, html: str) -> Dict[str, Any]:
    """Generic clean article parser for PowerPyx, Game8, PC Gamer, Eurogamer, Polygon, or Google results."""
    domain = _domain_from_url(url)

    cleaned_html = re.sub(
        r"<(?:script|style|noscript|iframe)[^>]*>.*?</(?:script|style|noscript|iframe)>",
        "",
        html,
        flags=re.S | re.I,
    )

    title_m = re.search(r"<h1[^>]*>(.*?)</h1>", cleaned_html, re.S | re.I)
    if not title_m:
        title_m = re.search(r"<title[^>]*>(.*?)</title>", cleaned_html, re.S | re.I)
    title = _strip_tags(title_m.group(1)) if title_m else url

    article_html = ""
    balanced_selectors = [
        ("div", r'<div[^>]+id="article-body"[^>]*>'),
        ("div", r'<div[^>]+class="[^"]*\bentry-content\b[^"]*"[^>]*>'),
        ("div", r'<div[^>]+class="[^"]*\barticle_body_content\b[^"]*"[^>]*>'),
        ("div", r'<div[^>]+class="[^"]*\barchive-style-wrapper\b[^"]*"[^>]*>'),
        ("article", r"<article[^>]*>"),
        ("main", r"<main[^>]*>"),
    ]
    for tag_name, pat in balanced_selectors:
        candidate = _extract_balanced_tag(cleaned_html, pat, tag_name=tag_name)
        if len(candidate) > 250:
            article_html = candidate
            break

    if not article_html:
        body_m = re.search(r"<body[^>]*>(.*?)</body>", cleaned_html, re.S | re.I)
        article_html = body_m.group(1) if body_m else cleaned_html

    article_html = re.sub(
        r"<(?:nav|header|footer|aside)[^>]*>.*?</(?:nav|header|footer|aside)>",
        "",
        article_html,
        flags=re.S | re.I,
    )

    sections: List[Dict[str, Any]] = []
    parts = re.split(r"(<h2[^>]*>.*?</h2>)", article_html, flags=re.S | re.I)
    base_url = f"https://{urllib.parse.urlparse(url).netloc}"

    intro_blocks = parse_html_to_blocks(parts[0], base_url=base_url)
    if intro_blocks:
        sections.append({"id": "overview", "title": "Tổng quan", "blocks": intro_blocks})

    for idx in range(1, len(parts), 2):
        h2_html = parts[idx]
        body_html = parts[idx + 1] if idx + 1 < len(parts) else ""
        sec_title = _strip_tags(h2_html)
        id_m = re.search(r'id="([^"]+)"', h2_html)
        sec_id = id_m.group(1) if id_m else f"sec-{idx}"
        blocks = parse_html_to_blocks(body_html, base_url=base_url)
        if blocks:
            sections.append(
                {
                    "id": sec_id,
                    "title": sec_title or f"Phần {len(sections) + 1}",
                    "blocks": blocks,
                }
            )

    if not sections:
        fallback_blocks = parse_html_to_blocks(article_html, base_url=base_url)
        if not fallback_blocks:
            plain = _strip_tags(article_html)
            if plain:
                fallback_blocks = [{"type": "paragraph", "text": plain[:8000]}]
        sections.append(
            {
                "id": "overview",
                "title": title,
                "blocks": fallback_blocks,
            }
        )

    # Extract in-site guide subpage links (e.g., Game8 /archives/ or PowerPyx walkthrough parts)
    related_pages: List[Dict[str, str]] = []
    seen_links = {url}
    host = urllib.parse.urlparse(url).netloc
    for lm in re.finditer(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', article_html, re.S):
        href = lm.group(1).strip()
        full_href = urllib.parse.urljoin(base_url, href)
        if host not in full_href or full_href in seen_links:
            continue
        label = _strip_tags(lm.group(2))
        if not label or len(label) < 4 or len(label) > 90:
            continue
        if any(k in full_href.lower() for k in ("walkthrough", "guide", "/archives/", "/wikis/")):
            seen_links.add(full_href)
            src, gid = _guide_id_for_url(full_href)
            if src == "web":
                related_pages.append({"guide_id": full_href, "title": label})

    return {
        "guide_id": url,
        "source": "web",
        "title": title,
        "author": domain or "Web Guide",
        "appid": 0,
        "game_name": title,
        "url": url,
        "sections": sections,
        "related_pages": related_pages[:20],
    }


def _fetch_web_guide(url: str) -> Dict[str, Any]:
    search_guide = _search_page_fallback_guide(url)
    if search_guide is not None:
        return search_guide
    html = _http_get(url, timeout=9)
    return _parse_web_guide_html(url, html)


def parse_guide_from_raw_html(source: str, guide_id: str, html: str) -> Dict[str, Any]:
    """Parses already-downloaded HTML (e.g. from frontend fetchNoCors fallback) into GuideContent."""
    resolved_src, resolved_id = _guide_id_for_url(guide_id) if source in ("web", "google") else (source, guide_id)
    if resolved_src == "ign":
        return _parse_ign_html(resolved_id, html)
    if resolved_src == "steam":
        return _parse_steam_guide_html(resolved_id, html)
    parsed = _parse_web_guide_html(guide_id, html)
    # If CSR search page only yielded placeholder chrome without real links, enrich via search_walkthroughs
    if len(parsed.get("related_pages", [])) == 0 and sum(len(s.get("blocks", [])) for s in parsed.get("sections", [])) <= 3:
        search_guide = _search_page_fallback_guide(guide_id)
        if search_guide is not None:
            return search_guide
    return parsed


def diagnose_connectivity() -> List[Dict[str, Any]]:
    """Checks reachability and latency to each walkthrough source from Python backend."""
    targets = [
        ("IGN GraphQL", "https://mollusk.apis.ign.com/graphql"),
        ("IGN Wikis", "https://www.ign.com/wikis/elden-ring/Walkthrough"),
        ("PowerPyx", "https://www.powerpyx.com/"),
        ("PC Gamer", "https://www.pcgamer.com/"),
        ("Game8", "https://game8.co/"),
        ("StrategyWiki", "https://strategywiki.org/w/api.php?action=query&meta=siteinfo&format=json"),
        ("Steam Guides", "https://steamcommunity.com/app/1245620/guides/"),
    ]

    def probe(name: str, url: str) -> Dict[str, Any]:
        t0 = time.time()
        try:
            if name == "IGN GraphQL":
                _http_post_json(
                    url,
                    {
                        "query": IGN_UNIFIED_SEARCH_QUERY,
                        "variables": {"term": "elden ring", "types": ["Guides"], "countPerType": 1},
                    },
                    extra_headers={"apollographql-client-name": "ign-web"},
                    timeout=6,
                )
            else:
                _http_get(url, timeout=6)
            return {
                "name": name,
                "ok": True,
                "ms": int((time.time() - t0) * 1000),
                "error": "",
            }
        except Exception as exc:
            return {
                "name": name,
                "ok": False,
                "ms": int((time.time() - t0) * 1000),
                "error": str(exc)[:140],
            }

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as pool:
        futs = [pool.submit(probe, name, url) for name, url in targets]
        return [f.result() for f in futs]


def fetch_guide_content(source: str, guide_id: str) -> Dict[str, Any]:
    if source in ("web", "google"):
        resolved_src, resolved_id = _guide_id_for_url(guide_id)
        if resolved_src == "ign":
            return _fetch_ign_guide(resolved_id)
        if resolved_src == "steam":
            return _fetch_steam_guide(resolved_id)
        if resolved_src == "strategywiki":
            return _fetch_strategywiki_guide(resolved_id)
        return _fetch_web_guide(guide_id)
    if source == "ign":
        return _fetch_ign_guide(guide_id)
    if source == "steam":
        return _fetch_steam_guide(guide_id)
    if source == "strategywiki":
        return _fetch_strategywiki_guide(guide_id)
    raise ValueError(f"Unsupported source: {source}")
