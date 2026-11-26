import { toaster } from "@decky/api";
import {
  DialogButton,
  Dropdown,
  Focusable,
  Navigation,
  Spinner,
  TextField,
} from "@decky/ui";
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaBookmark,
  FaChevronLeft,
  FaChevronRight,
  FaExpand,
  FaExternalLinkAlt,
  FaGlobe,
  FaMapPin,
  FaRegBookmark,
  FaSyncAlt,
} from "react-icons/fa";
import {
  FULL_READER_ROUTE,
  fetchGuideWithFallback,
  getGameEntry,
  openGoogleInBrowser,
  openUrlInBrowser,
  resolveGuideUrl,
  saveProgress,
  setGameBookmarked,
  togglePinnedSection,
  withTimeout,
} from "../api";
import { setActiveReaderTarget, useSharedStore } from "../state";
import {
  ActiveReaderTarget,
  GuideBlock,
  GuideContent,
  GuideSection,
  PinnedSection,
} from "../types";
import { GuideBlocks } from "./GuideBlocks";

interface GuideReaderProps {
  target: ActiveReaderTarget;
  compact?: boolean;
  onProgressSaved?: () => void;
  onBack?: () => void;
  onSwitchToBrowserMode?: () => void;
}

function sectionMatchesQuery(section: GuideSection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (section.title.toLowerCase().includes(q)) return true;
  for (const b of section.blocks as GuideBlock[]) {
    if ("text" in b && b.text.toLowerCase().includes(q)) return true;
    if (b.type === "list" && b.items.some((it) => it.toLowerCase().includes(q))) {
      return true;
    }
    if (
      b.type === "table" &&
      b.rows.some((row) => row.some((c) => c.toLowerCase().includes(q)))
    ) {
      return true;
    }
  }
  return false;
}

function findBestMatchingSectionIndex(
  sections: GuideSection[],
  hint?: string
): number {
  const raw = (hint || "").trim().toLowerCase();
  if (!raw || sections.length <= 1) return -1;
  const stopwords = new Set([
    "in",
    "at",
    "on",
    "the",
    "of",
    "exploring",
    "playing",
    "area",
    "region",
    "location",
  ]);
  const tokens = raw
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stopwords.has(t));
  if (tokens.length === 0) return -1;

  let bestIdx = -1;
  let bestScore = 0;

  sections.forEach((sec, idx) => {
    const titleL = sec.title.toLowerCase();
    let score = 0;
    if (titleL.includes(raw)) score += 60;
    for (const tok of tokens) {
      if (titleL.includes(tok)) score += 25;
      else if (sectionMatchesQuery(sec, tok)) score += 8;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestScore >= 16 ? bestIdx : -1;
}

export const GuideReader: FC<GuideReaderProps> = ({
  target,
  compact = true,
  onProgressSaved,
  onBack,
  onSwitchToBrowserMode,
}) => {
  const { settings } = useSharedStore();
  const [guide, setGuide] = useState<GuideContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [bookmarked, setBookmarked] = useState(Boolean(target.bookmarked));
  const [pinnedSections, setPinnedSections] = useState<PinnedSection[]>([]);
  const [filterText, setFilterText] = useState("");
  const [showToc, setShowToc] = useState(false);
  const [resumedBanner, setResumedBanner] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRatioRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestProgressRef = useRef<{
    guide: GuideContent | null;
    sectionIdx: number;
    scrollRatio: number;
    bookmarked: boolean;
  }>({
    guide: null,
    sectionIdx: 0,
    scrollRatio: 0,
    bookmarked: Boolean(target.bookmarked),
  });

  const persistProgressNow = useCallback(
    async (
      loadedGuide: GuideContent,
      idx: number,
      ratio: number,
      isBookmarked: boolean,
      showToast = false
    ) => {
      const sections = loadedGuide.sections;
      if (!sections.length) return;
      const safeIdx = Math.max(0, Math.min(idx, sections.length - 1));
      const sec = sections[safeIdx];
      try {
        await saveProgress(
          target.game_key,
          target.appid || loadedGuide.appid || 0,
          target.game_name || loadedGuide.game_name,
          target.game_image,
          loadedGuide.source,
          loadedGuide.guide_id,
          loadedGuide.title,
          loadedGuide.author,
          safeIdx,
          sec.id,
          sec.title,
          sections.length,
          ratio,
          isBookmarked
        );
        onProgressSaved?.();
        if (showToast) {
          toaster.toast({
            title: "Đã lưu vị trí đang xem",
            body: `${sec.title} (${Math.round(ratio * 100)}%)`,
          });
        }
      } catch (err) {
        console.error("Failed to save progress", err);
      }
    },
    [target, onProgressSaved]
  );

  const loadGuide = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const [data, savedGame] = await Promise.all([
          fetchGuideWithFallback(
            target.source,
            target.guide_id,
            forceRefresh,
            target.guide_url,
            forceRefresh ? undefined : target.prefetched_html
          ),
          withTimeout(getGameEntry(target.game_key), 3000, "timeout").catch(
            () => null
          ),
        ]);

        setGuide(data);
        if (savedGame) {
          setBookmarked(Boolean(savedGame.bookmarked));
          setPinnedSections(savedGame.pinned_sections || []);
        } else {
          setBookmarked(Boolean(target.bookmarked));
          setPinnedSections([]);
        }

        // Determine initial section & scroll offset to resume
        let initialIdx = 0;
        let initialRatio = 0;
        let jumpedToHint = false;

        if (typeof target.resume_section_index === "number") {
          initialIdx = target.resume_section_index;
          initialRatio = target.resume_scroll_ratio ?? 0;
        } else if (data.saved_progress) {
          initialIdx = data.saved_progress.section_index;
          initialRatio = data.saved_progress.scroll_ratio ?? 0;
        } else if (
          savedGame &&
          savedGame.active_guide_id === data.guide_id &&
          savedGame.active_source === data.source
        ) {
          initialIdx = savedGame.section_index;
          initialRatio = savedGame.scroll_ratio ?? 0;
        } else if (target.location_hint) {
          const matchedIdx = findBestMatchingSectionIndex(
            data.sections,
            target.location_hint
          );
          if (matchedIdx >= 0) {
            initialIdx = matchedIdx;
            jumpedToHint = true;
          }
        }

        if (target.resume_section_id && data.sections.length > 0) {
          const byId = data.sections.findIndex(
            (s) => s.id === target.resume_section_id
          );
          if (byId >= 0) initialIdx = byId;
        }

        const clampedIdx = Math.max(
          0,
          Math.min(initialIdx, Math.max(0, data.sections.length - 1))
        );
        setSectionIdx(clampedIdx);
        setScrollRatio(initialRatio);
        pendingRestoreRatioRef.current = initialRatio;

        if (jumpedToHint) {
          const secTitle = data.sections[clampedIdx]?.title || "";
          setResumedBanner(`Đã nhảy tới mục khớp vị trí: ${secTitle}`);
        } else if (clampedIdx > 0 || initialRatio > 0.03) {
          const secTitle = data.sections[clampedIdx]?.title || "";
          setResumedBanner(
            `Đã mở tiếp: ${secTitle} (${Math.round(initialRatio * 100)}%)`
          );
        } else {
          setResumedBanner(null);
        }

        latestProgressRef.current = {
          guide: data,
          sectionIdx: clampedIdx,
          scrollRatio: initialRatio,
          bookmarked: savedGame
            ? Boolean(savedGame.bookmarked)
            : Boolean(target.bookmarked),
        };

        await persistProgressNow(
          data,
          clampedIdx,
          initialRatio,
          savedGame ? Boolean(savedGame.bookmarked) : Boolean(target.bookmarked)
        );
      } catch (e: any) {
        setError(e?.message || "Không thể tải walkthrough. Kiểm tra kết nối mạng.");
      } finally {
        setLoading(false);
      }
    },
    [target, persistProgressNow]
  );

  useEffect(() => {
    loadGuide(false);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const snap = latestProgressRef.current;
      if (snap.guide) {
        persistProgressNow(
          snap.guide,
          snap.sectionIdx,
          snap.scrollRatio,
          snap.bookmarked
        );
      }
    };
  }, [loadGuide, persistProgressNow]);

  useEffect(() => {
    if (loading || pendingRestoreRatioRef.current === null) return;
    const ratio = pendingRestoreRatioRef.current;
    pendingRestoreRatioRef.current = null;
    const el = scrollContainerRef.current;
    if (!el) return;
    window.requestAnimationFrame(() => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.round(maxScroll * ratio);
    });
  }, [loading, sectionIdx]);

  const scheduleSave = useCallback(
    (loadedGuide: GuideContent, idx: number, ratio: number, isBookmarked: boolean) => {
      latestProgressRef.current = {
        guide: loadedGuide,
        sectionIdx: idx,
        scrollRatio: ratio,
        bookmarked: isBookmarked,
      };
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        persistProgressNow(loadedGuide, idx, ratio, isBookmarked);
      }, 650);
    },
    [persistProgressNow]
  );

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !guide) return;
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = el.scrollHeight <= el.clientHeight ? 0 : el.scrollTop / maxScroll;
    setScrollRatio(ratio);
    scheduleSave(guide, sectionIdx, ratio, bookmarked);
  }, [guide, sectionIdx, bookmarked, scheduleSave]);

  const jumpToSection = useCallback(
    (newIdx: number, newRatio = 0) => {
      if (!guide) return;
      const clamped = Math.max(0, Math.min(newIdx, guide.sections.length - 1));
      setSectionIdx(clamped);
      setScrollRatio(newRatio);
      setResumedBanner(null);
      pendingRestoreRatioRef.current = newRatio;
      latestProgressRef.current = {
        guide,
        sectionIdx: clamped,
        scrollRatio: newRatio,
        bookmarked,
      };
      persistProgressNow(guide, clamped, newRatio, bookmarked);
      if (scrollContainerRef.current && newRatio === 0) {
        scrollContainerRef.current.scrollTop = 0;
      }
    },
    [guide, bookmarked, persistProgressNow]
  );

  const handleToggleBookmark = async () => {
    const next = !bookmarked;
    setBookmarked(next);
    latestProgressRef.current.bookmarked = next;
    try {
      await setGameBookmarked(
        target.game_key,
        next,
        target.appid || guide?.appid || 0,
        target.game_name || guide?.game_name || "",
        target.game_image
      );
      onProgressSaved?.();
      toaster.toast({
        title: next ? "Đã lưu game" : "Đã bỏ lưu game",
        body: target.game_name,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleTogglePinSection = async () => {
    if (!guide) return;
    const sec = guide.sections[sectionIdx];
    if (!sec) return;
    try {
      const updated = await togglePinnedSection(
        target.game_key,
        guide.guide_id,
        guide.source,
        sectionIdx,
        sec.id,
        sec.title
      );
      setPinnedSections(updated);
      onProgressSaved?.();
      const isNowPinned = updated.some(
        (p) => p.guide_id === guide.guide_id && p.section_id === sec.id
      );
      toaster.toast({
        title: isNowPinned ? "Đã ghim mục này" : "Đã bỏ ghim mục",
        body: sec.title,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFullscreen = () => {
    setActiveReaderTarget({
      ...target,
      guide_title: guide?.title || target.guide_title,
      guide_author: guide?.author || target.guide_author,
      resume_section_index: sectionIdx,
      resume_section_id: guide?.sections[sectionIdx]?.id,
      resume_scroll_ratio: scrollRatio,
      bookmarked,
    });
    Navigation.Navigate(FULL_READER_ROUTE);
    Navigation.CloseSideMenus();
  };

  const filteredSections = useMemo(() => {
    if (!guide) return [];
    return guide.sections
      .map((sec, idx) => ({ sec, idx }))
      .filter(({ sec }) => sectionMatchesQuery(sec, filterText));
  }, [guide, filterText]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 12px",
          gap: "10px",
        }}
      >
        <div style={{ width: "28px", height: "28px" }}>
          <Spinner style={{ width: "28px", height: "28px" }} />
        </div>
        <div style={{ fontSize: "12px", color: "#b8bcbf" }}>
          Đang tải bản gọn...
        </div>
        {onSwitchToBrowserMode ? (
          <DialogButton
            onClick={onSwitchToBrowserMode}
            style={{ width: "auto", minWidth: "130px", padding: "6px 12px", fontSize: "11px" }}
          >
            {compact ? "Mở Web Live" : "Quay lại Web trực tiếp"}
          </DialogButton>
        ) : null}
      </div>
    );
  }

  if (error || !guide) {
    const fallbackUrl = resolveGuideUrl(
      target.source,
      target.guide_id,
      target.guide_url
    );
    return (
      <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ color: "#ff7a7a", fontSize: "12px", lineHeight: 1.4 }}>
          {error || "Không có dữ liệu hướng dẫn."}
        </div>
        <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <DialogButton
              onClick={() => loadGuide(true)}
              style={{ width: "100%", minWidth: 0, padding: "6px 8px", fontSize: "12px" }}
            >
              Thử lại
            </DialogButton>
          </div>
          {onSwitchToBrowserMode ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                onClick={onSwitchToBrowserMode}
                style={{ width: "100%", minWidth: 0, padding: "6px 8px", fontSize: "12px" }}
              >
                {compact ? "Mở Web Live" : "Xem Web trực tiếp"}
              </DialogButton>
            </div>
          ) : onBack ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                onClick={onBack}
                style={{ width: "100%", minWidth: 0, padding: "6px 8px", fontSize: "12px" }}
              >
                Quay lại
              </DialogButton>
            </div>
          ) : null}
        </Focusable>
        <DialogButton
          onClick={() =>
            fallbackUrl
              ? openUrlInBrowser(fallbackUrl)
              : openGoogleInBrowser(target.game_name, target.location_hint)
          }
          style={{
            width: "100%",
            minWidth: 0,
            padding: "7px 8px",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          <FaExternalLinkAlt size={11} />
          <span>Xem bằng trình duyệt ngoài</span>
        </DialogButton>
      </div>
    );
  }

  const currentSection = guide.sections[sectionIdx];
  const isPinned = Boolean(
    currentSection &&
      pinnedSections.some(
        (p) =>
          p.guide_id === guide.guide_id &&
          p.source === guide.source &&
          p.section_id === currentSection.id
      )
  );

  const dropdownOptions = guide.sections.map((s, idx) => ({
    data: idx,
    label: `${idx + 1}/${guide.sections.length} • ${s.title}`,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Header card */}
      <div
        style={{
          backgroundColor: "rgba(255,255,255,0.05)",
          borderRadius: "6px",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff", lineHeight: 1.3 }}>
          {guide.title}
        </div>
        <div style={{ fontSize: "11px", color: "#8f98a0" }}>
          {target.game_name || guide.game_name} • {guide.author}
          {guide.stale_offline
            ? " • Offline (bản lưu)"
            : guide.cached
            ? " • Đã lưu offline"
            : ""}
        </div>

        <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px", width: "100%" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <DialogButton
              onClick={handleToggleBookmark}
              style={{
                width: "100%",
                minWidth: 0,
                padding: "5px 6px",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              {bookmarked ? <FaBookmark color="#f5c542" /> : <FaRegBookmark />}
              <span>{bookmarked ? "Đã lưu" : "Lưu game"}</span>
            </DialogButton>
          </div>
          {compact ? (
            <div style={{ width: "36px", flexShrink: 0 }}>
              <DialogButton
                onClick={handleOpenFullscreen}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "6px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaExpand size={12} />
              </DialogButton>
            </div>
          ) : null}
          <div style={{ width: "36px", flexShrink: 0 }}>
            <DialogButton
              onClick={() => loadGuide(true)}
              style={{
                width: "100%",
                minWidth: 0,
                padding: "6px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FaSyncAlt size={12} />
            </DialogButton>
          </div>
          {onSwitchToBrowserMode ? (
            <div style={{ width: "36px", flexShrink: 0 }}>
              <DialogButton
                onClick={onSwitchToBrowserMode}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "6px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaGlobe size={12} />
              </DialogButton>
            </div>
          ) : null}
          <div style={{ width: "36px", flexShrink: 0 }}>
            <DialogButton
              onClick={() =>
                openUrlInBrowser(
                  resolveGuideUrl(guide.source, guide.guide_id, guide.url)
                )
              }
              style={{
                width: "100%",
                minWidth: 0,
                padding: "6px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FaExternalLinkAlt size={11} />
            </DialogButton>
          </div>
        </Focusable>

        {resumedBanner ? (
          <div
            style={{
              fontSize: "11px",
              color: "#66c0f4",
              backgroundColor: "rgba(102, 192, 244, 0.14)",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            {resumedBanner}
          </div>
        ) : null}
      </div>

      {/* Section selector & navigation controls */}
      {guide.sections.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Dropdown
            rgOptions={dropdownOptions}
            selectedOption={sectionIdx}
            onChange={(opt) => jumpToSection(Number(opt.data), 0)}
            strDefaultLabel="Chọn mục lục"
          />

          <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px", width: "100%" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                disabled={sectionIdx <= 0}
                onClick={() => jumpToSection(sectionIdx - 1, 0)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "6px 4px",
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <FaChevronLeft size={10} />
                <span>Trước</span>
              </DialogButton>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                onClick={handleTogglePinSection}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "6px 4px",
                  fontSize: "11px",
                  color: isPinned ? "#f5c542" : undefined,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <FaMapPin size={10} />
                <span>{isPinned ? "Đã ghim" : "Ghim"}</span>
              </DialogButton>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                disabled={sectionIdx >= guide.sections.length - 1}
                onClick={() => jumpToSection(sectionIdx + 1, 0)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "6px 4px",
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <span>Sau</span>
                <FaChevronRight size={10} />
              </DialogButton>
            </div>
          </Focusable>
        </div>
      ) : null}

      {/* In-guide filter + TOC toggle */}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextField
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Tìm trong guide..."
          />
        </div>
        <div style={{ width: "74px", flexShrink: 0 }}>
          <DialogButton
            onClick={() => setShowToc((prev) => !prev)}
            style={{ width: "100%", minWidth: 0, padding: "6px 4px", fontSize: "11px" }}
          >
            {showToc ? "Ẩn" : `Mục (${filteredSections.length})`}
          </DialogButton>
        </div>
      </Focusable>

      {/* Pinned sections quick chips */}
      {pinnedSections.filter(
        (p) => p.guide_id === guide.guide_id && p.source === guide.source
      ).length > 0 ? (
        <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {pinnedSections
            .filter((p) => p.guide_id === guide.guide_id && p.source === guide.source)
            .map((pin) => (
              <div key={pin.section_id} style={{ maxWidth: "100%" }}>
                <DialogButton
                  onClick={() => jumpToSection(pin.section_index, 0)}
                  style={{
                    width: "auto",
                    minWidth: 0,
                    fontSize: "11px",
                    padding: "4px 8px",
                    backgroundColor: "rgba(245, 197, 66, 0.14)",
                    color: "#f5c542",
                  }}
                >
                  ★ {pin.section_title}
                </DialogButton>
              </div>
            ))}
        </Focusable>
      ) : null}

      {/* Expandable Table of Contents / Search match list */}
      {(showToc || filterText.trim().length > 0) && guide.sections.length > 0 ? (
        <Focusable
          style={{
            backgroundColor: "rgba(0,0,0,0.28)",
            borderRadius: "6px",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {filteredSections.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#8f98a0", padding: "4px" }}>
              Không tìm thấy mục nào khớp "{filterText}".
            </div>
          ) : (
            filteredSections.map(({ sec, idx }) => (
              <DialogButton
                key={`${sec.id}-${idx}`}
                onClick={() => {
                  jumpToSection(idx, 0);
                  setShowToc(false);
                }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  textAlign: "left",
                  padding: "6px 8px",
                  fontSize: "12px",
                  backgroundColor:
                    idx === sectionIdx
                      ? "rgba(102, 192, 244, 0.25)"
                      : "rgba(255,255,255,0.04)",
                }}
              >
                {idx + 1}. {sec.title}
              </DialogButton>
            ))
          )}
        </Focusable>
      ) : null}

      {/* Main content area: in QAM compact mode let QAM scroll natively so D-pad & touch never get trapped */}
      <div
        ref={scrollContainerRef}
        onScroll={compact ? undefined : handleScroll}
        style={
          compact
            ? {
                backgroundColor: "rgba(0,0,0,0.28)",
                borderRadius: "6px",
                padding: "10px",
                border: "1px solid rgba(255,255,255,0.1)",
              }
            : {
                maxHeight: "calc(100vh - 250px)",
                overflowY: "auto",
                backgroundColor: "rgba(0,0,0,0.22)",
                borderRadius: "6px",
                padding: "14px 18px",
                border: "1px solid rgba(255,255,255,0.08)",
              }
        }
      >
        {currentSection ? (
          <>
            <div
              style={{
                fontSize: compact ? "15px" : "18px",
                fontWeight: 700,
                color: "#ffffff",
                marginBottom: "8px",
                paddingBottom: "6px",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {currentSection.title}
            </div>
            <GuideBlocks
              blocks={currentSection.blocks}
              fontSize={settings.font_size}
              hideSpoilers={settings.hide_spoilers}
              highlightQuery={filterText}
            />
          </>
        ) : null}

        {/* IGN Wiki / StrategyWiki related pages navigation */}
        {guide.related_pages && guide.related_pages.length > 0 ? (
          <div
            style={{
              marginTop: "14px",
              paddingTop: "10px",
              borderTop: "1px solid rgba(255,255,255,0.12)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#66c0f4" }}>
              Các chương / trang liên quan ({guide.source === "ign" ? "IGN Wiki" : "Wiki"}):
            </div>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {guide.related_pages.slice(0, 16).map((rp) => (
                <DialogButton
                  key={rp.guide_id}
                  onClick={() => {
                    const isUrl = /^https?:\/\//i.test(rp.guide_id);
                    const nextTarget: ActiveReaderTarget = {
                      ...target,
                      source: isUrl ? "web" : guide.source,
                      guide_id: rp.guide_id,
                      guide_url: isUrl ? rp.guide_id : undefined,
                      guide_title: rp.title,
                      prefetched_html: undefined,
                      resume_section_index: 0,
                      resume_scroll_ratio: 0,
                    };
                    setActiveReaderTarget(nextTarget);
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    textAlign: "left",
                    fontSize: "11px",
                    padding: "6px 8px",
                  }}
                >
                  {rp.title}
                </DialogButton>
              ))}
            </Focusable>
          </div>
        ) : null}
      </div>

      {/* Footer status, save & browser button */}
      <Focusable
        flow-children="horizontal"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <div style={{ fontSize: "11px", color: "#8f98a0", flex: 1, minWidth: 0 }}>
          Mục {sectionIdx + 1}/{guide.sections.length} • {Math.round(scrollRatio * 100)}%
        </div>
        <div style={{ width: "78px", flexShrink: 0 }}>
          <DialogButton
            onClick={() =>
              persistProgressNow(guide, sectionIdx, scrollRatio, bookmarked, true)
            }
            style={{ width: "100%", minWidth: 0, padding: "5px 4px", fontSize: "11px" }}
          >
            Lưu vị trí
          </DialogButton>
        </div>
        <div style={{ width: "84px", flexShrink: 0 }}>
          <DialogButton
            onClick={() =>
              openUrlInBrowser(
                resolveGuideUrl(guide.source, guide.guide_id, guide.url)
              )
            }
            style={{
              width: "100%",
              minWidth: 0,
              padding: "5px 4px",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <FaExternalLinkAlt size={10} />
            <span>Trình duyệt</span>
          </DialogButton>
        </div>
      </Focusable>
    </div>
  );
};
