import json
import os
import tempfile
import unittest
from unittest.mock import patch

from py_modules.storage import WalkthroughStorage
from py_modules.walkthrough_sources import (
    _clean_game_name,
    _clean_subprocess_env,
    _extract_balanced_tag,
    _fetch_web_guide,
    _list_ign_guides,
    _parse_steam_guides_html,
    _search_ign_wikis_broad,
    fetch_guide_content,
    parse_html_to_blocks,
    search_walkthroughs,
)


class TestHtmlBlockParser(unittest.TestCase):
    def test_parses_steam_bbcode_elements(self):
        sample_html = """
        <div class="bb_h1">Boss Strategy</div>
        <p>Use fire damage against the boss.</p>
        <ul class="bb_ul">
          <li>Dodge left on sweep</li>
          <li>Heal behind pillar</li>
        </ul>
        <span class="bb_spoiler">Secret ending unlocks after item X</span>
        <div class="bb_blockquote">Tip: Bring 3 flasks.</div>
        <img src="https://example.com/map.jpg" alt="Dungeon Map" />
        <img src="https://steamcommunity.com/economy/emoticon/smile" alt=":smile:" />
        <table class="bb_table">
          <tr><th>Phase</th><th>Weakness</th></tr>
          <tr><td>Phase 1</td><td>Fire</td></tr>
        </table>
        <script>alert("ignore")</script>
        """
        blocks = parse_html_to_blocks(sample_html)
        types = [b["type"] for b in blocks]
        self.assertEqual(
            types,
            ["heading", "paragraph", "list", "spoiler", "quote", "image", "table"],
        )
        self.assertEqual(blocks[0], {"type": "heading", "level": 1, "text": "Boss Strategy"})
        self.assertEqual(blocks[2]["items"], ["Dodge left on sweep", "Heal behind pillar"])
        self.assertEqual(blocks[3]["text"], "Secret ending unlocks after item X")
        self.assertEqual(blocks[5]["url"], "https://example.com/map.jpg")
        self.assertEqual(blocks[6]["rows"][1], ["Phase 1", "Fire"])

    def test_skips_nav_box_and_noprint(self):
        wiki_html = """
        <div class="nav_box header_nav"><ul><li>Nav Link</li></ul></div>
        <p>Actual walkthrough step 1.</p>
        """
        blocks = parse_html_to_blocks(wiki_html, base_url="https://strategywiki.org")
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["text"], "Actual walkthrough step 1.")


class TestWalkthroughSources(unittest.TestCase):
    def test_parse_steam_guides_list(self):
        html = """
        <div class="workshopItem">
          <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=12345" data-publishedfileid="12345">
            <img class="workshopItemPreviewImage" src="https://img.test/thumb.jpg" />
          </a>
          <img class="fileRating" src="https://community.akamai.steamstatic.com/public/images/sharedfiles/5-star.png" />
          <div class="workshopItemTitle">Complete 100% Walkthrough</div>
          <div class="workshopItemAuthorName">by <a>GuideAuthor</a></div>
        </div>
        """
        guides = _parse_steam_guides_html(html, 1245620, "ELDEN RING", "")
        self.assertEqual(len(guides), 1)
        self.assertEqual(guides[0]["guide_id"], "12345")
        self.assertEqual(guides[0]["title"], "Complete 100% Walkthrough")
        self.assertEqual(guides[0]["author"], "by GuideAuthor")
        self.assertEqual(guides[0]["rating_stars"], 5)

    def test_fetch_steam_guide_sections(self):
        fake_page = """
        <div class="breadcrumbs"><a href="https://steamcommunity.com/app/1245620">ELDEN RING</a></div>
        <div class="workshopItemTitle">Elden Ring Walkthrough</div>
        <div class="friendBlockContent">ponkberry<br/></div>
        <div class="subSection detailBox" id="501">
          <div class="subSectionTitle">Chapter 1: Limgrave</div>
          <div class="subSectionDesc">Head north to Church of Elleh.</div>
          <div style="clear: both"></div>
        </div>
        <div class="subSection detailBox" id="502">
          <div class="subSectionTitle">Chapter 2: Stormveil</div>
          <div class="subSectionDesc">Defeat Margit first.</div>
          <div style="clear: both"></div>
        </div>
        """
        with patch("py_modules.walkthrough_sources._http_get", return_value=fake_page):
            guide = fetch_guide_content("steam", "2785187510")

        self.assertEqual(guide["title"], "Elden Ring Walkthrough")
        self.assertEqual(guide["appid"], 1245620)
        self.assertEqual(len(guide["sections"]), 2)
        self.assertEqual(guide["sections"][1]["id"], "502")
        self.assertEqual(guide["sections"][1]["title"], "Chapter 2: Stormveil")
        self.assertEqual(guide["sections"][1]["blocks"][0]["text"], "Defeat Margit first.")

    def test_clean_game_name_and_broad_url_search(self):
        self.assertEqual(
            _clean_game_name("The Legend of Zelda: Ocarina of Time (USA).z64"),
            "The Legend of Zelda: Ocarina of Time",
        )
        items, hint = _search_ign_wikis_broad(
            "https://www.ign.com/wikis/ocarina-of-time-remake/Walkthrough"
        )
        self.assertEqual(items[0]["slug"], "ocarina-of-time-remake")
        self.assertTrue(items[0]["has_guide_match"])
        self.assertEqual(hint, "")

    def test_web_guide_parser_and_direct_url_search(self):
        fake_article = """
        <html><body>
          <h1>Elden Ring Boss Guide</h1>
          <div class="entry-content">
            <p>Prepare your flasks before entering.</p>
            <h2>Margit, the Fell Omen</h2>
            <p>Dodge delayed staff slams and punish recovery.</p>
          </div>
          <footer>Copyright</footer>
        </body></html>
        """
        with patch("py_modules.walkthrough_sources._http_get", return_value=fake_article):
            doc = _fetch_web_guide("https://www.powerpyx.com/elden-ring-boss-guide/")
            self.assertEqual(doc["source"], "web")
            self.assertEqual(doc["title"], "Elden Ring Boss Guide")
            self.assertEqual(len(doc["sections"]), 2)
            self.assertEqual(doc["sections"][1]["title"], "Margit, the Fell Omen")

        direct = search_walkthroughs("https://www.ign.com/wikis/ocarina-of-time-remake/Walkthrough")
        self.assertEqual(direct["guides"][0]["source"], "ign")
        self.assertEqual(direct["guides"][0]["guide_id"], "ocarina-of-time-remake/Walkthrough")

    def test_clean_subprocess_env_and_balanced_tag_extraction(self):
        with patch.dict(
            os.environ,
            {"LD_LIBRARY_PATH": "/tmp/_MEI123", "LD_PRELOAD": "/tmp/overlay.so"},
            clear=False,
        ):
            env = _clean_subprocess_env()
            self.assertNotIn("LD_LIBRARY_PATH", env)
            self.assertNotIn("LD_PRELOAD", env)

        nested_html = (
            '<div class="entry-content">'
            '<div class="inner"><p>Step 1</p></div>'
            '<h2>Boss</h2><p>Step 2</p>'
            '</div><div class="sidebar">Ignore</div>'
        )
        extracted = _extract_balanced_tag(
            nested_html, r'<div class="entry-content">', tag_name="div"
        )
        self.assertIn("Step 1", extracted)
        self.assertIn("Step 2", extracted)
        self.assertNotIn("Ignore", extracted)

    def test_ign_wiki_ranks_matching_location_hint_first(self):
        next_payload = {
            "props": {
                "pageProps": {
                    "page": {
                        "wikiSlug": "elden-ring",
                        "name": "Elden Ring",
                        "canonical": "/wikis/elden-ring/Walkthrough",
                        "navigation": [
                            {
                                "label": "Walkthrough",
                                "url": "Walkthrough",
                                "subnav": [
                                    {"label": "Limgrave", "url": "Limgrave"},
                                    {"label": "Caelid - Dungeons and Bosses", "url": "Caelid"},
                                ],
                            }
                        ],
                        "page": {"title": "Walkthrough", "htmlEntities": []},
                    }
                }
            }
        }
        fake_html = (
            '<html><head><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps(next_payload)
            + "</script></head></html>"
        )
        with patch("py_modules.walkthrough_sources._http_get", return_value=fake_html):
            guides = _list_ign_guides(
                "elden-ring",
                1245620,
                "Elden Ring",
                "",
                location_hint="Exploring Caelid",
            )
            self.assertEqual(guides[0]["guide_id"], "elden-ring/Caelid")
            self.assertIn("caelid", guides[0]["match_reason"].lower())

    def test_ign_wiki_list_and_fetch_next_data(self):
        next_payload = {
            "props": {
                "pageProps": {
                    "page": {
                        "wikiSlug": "elden-ring",
                        "name": "Elden Ring",
                        "canonical": "/wikis/elden-ring/Walkthrough",
                        "navigation": [
                            {
                                "label": "Walkthrough",
                                "url": "Walkthrough",
                                "subnav": [
                                    {"label": "Limgrave", "url": "Limgrave"}
                                ],
                            }
                        ],
                        "page": {
                            "title": "Walkthrough",
                            "htmlEntities": [
                                {"values": {"tag": "p", "html": "<p>Intro text.</p>"}},
                                {"values": {"tag": "h2", "html": "<h2><span id=\"chap1\">Chapter 1</span></h2>"}},
                                {"values": {"tag": "p", "html": "<p>Defeat the first boss.</p>"}},
                            ],
                            "nextPage": {"title": "Limgrave", "url": "Limgrave"},
                        },
                    }
                }
            }
        }
        fake_html = (
            '<html><head><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps(next_payload)
            + "</script></head></html>"
        )
        with patch("py_modules.walkthrough_sources._http_get", return_value=fake_html):
            guides = _list_ign_guides("elden-ring", 1245620, "Elden Ring", "")
            self.assertGreaterEqual(len(guides), 2)
            self.assertEqual(guides[0]["source"], "ign")
            self.assertEqual(guides[0]["guide_id"], "elden-ring/Walkthrough")

            content = fetch_guide_content("ign", "elden-ring/Walkthrough")
            self.assertEqual(content["source"], "ign")
            self.assertEqual(len(content["sections"]), 2)
            self.assertEqual(content["sections"][1]["title"], "Chapter 1")
            self.assertEqual(content["sections"][1]["blocks"][0]["text"], "Defeat the first boss.")
            self.assertTrue(any(p["guide_id"] == "elden-ring/Limgrave" for p in content["related_pages"]))


class TestWalkthroughStorage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.settings_dir = os.path.join(self.tmpdir.name, "settings")
        self.runtime_dir = os.path.join(self.tmpdir.name, "runtime")
        self.storage = WalkthroughStorage(self.settings_dir, self.runtime_dir)

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_save_and_resume_progress_persists_across_reload(self):
        self.storage.save_progress(
            game_key="steam:1245620",
            appid=1245620,
            game_name="ELDEN RING",
            game_image="img.jpg",
            source="steam",
            guide_id="2785187510",
            guide_title="100% Guide",
            guide_author="ponkberry",
            section_index=4,
            section_id="5277037",
            section_title="Walkthrough: Liurnia",
            total_sections=28,
            scroll_ratio=1.5,  # should clamp to 1.0
            bookmarked=True,
        )

        # Reload from disk to verify persistence
        reloaded = WalkthroughStorage(self.settings_dir, self.runtime_dir)
        entry = reloaded.get_game_entry("steam:1245620")
        self.assertIsNotNone(entry)
        assert entry is not None
        self.assertTrue(entry["bookmarked"])
        self.assertEqual(entry["section_index"], 4)
        self.assertEqual(entry["section_id"], "5277037")
        self.assertEqual(entry["scroll_ratio"], 1.0)

        gp = reloaded.get_guide_progress("steam", "2785187510")
        self.assertIsNotNone(gp)
        assert gp is not None
        self.assertEqual(gp["section_title"], "Walkthrough: Liurnia")

    def test_bookmarked_games_sorted_first_and_pinned_sections_toggle(self):
        self.storage.save_progress(
            "steam:1", 1, "Recent Game", "", "steam", "g1", "G1", "A", 0, "s1", "S1", 2, 0.1, bookmarked=False
        )
        self.storage.save_progress(
            "steam:2", 2, "Saved Game", "", "steam", "g2", "G2", "B", 1, "s2", "S2", 5, 0.5, bookmarked=True
        )
        lib = self.storage.get_library()
        self.assertEqual(lib["games"][0]["game_key"], "steam:2")

        pins = self.storage.toggle_pinned_section("steam:2", "g2", "steam", 1, "s2", "S2")
        self.assertEqual(len(pins), 1)
        pins_after = self.storage.toggle_pinned_section("steam:2", "g2", "steam", 1, "s2", "S2")
        self.assertEqual(len(pins_after), 0)

    def test_offline_cache_roundtrip_and_clear(self):
        guide = {"guide_id": "2785187510", "source": "steam", "sections": [{"id": "1", "title": "Intro", "blocks": []}]}
        self.storage.save_cached_guide("steam", "2785187510", guide)
        cached = self.storage.get_cached_guide("steam", "2785187510")
        self.assertIsNotNone(cached)
        assert cached is not None
        self.assertTrue(cached["cached"])
        removed = self.storage.clear_cache()
        self.assertEqual(removed, 1)
        self.assertIsNone(self.storage.get_cached_guide("steam", "2785187510"))


if __name__ == "__main__":
    unittest.main()
