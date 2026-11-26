import { DialogButton, Focusable, Navigation } from "@decky/ui";
import { FC, useCallback, useEffect, useState } from "react";
import { FaBookmark, FaPlay, FaSteam, FaTimes } from "react-icons/fa";
import { getLibrary } from "../api";
import { EmbeddedBrowser } from "../components/EmbeddedBrowser";
import { getStrings } from "../i18n";
import { mergeLibraryGames, setActiveReaderTarget, useSharedStore } from "../state";
import { SavedGameEntry } from "../types";

export const FullReaderPage: FC = () => {
  const { activeTarget, targetLoadVersion, savedGames: games, settings } = useSharedStore();
  const s = getStrings(settings.language);
  const [showSavedDrawer, setShowSavedDrawer] = useState(false);

  const refreshLibrary = useCallback(async () => {
    try {
      const lib = await getLibrary();
      mergeLibraryGames(lib.games || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    if (showSavedDrawer) {
      refreshLibrary();
    }
  }, [showSavedDrawer, refreshLibrary]);

  const handleSelectSaved = (entry: SavedGameEntry) => {
    if (!entry.active_guide_id || !entry.active_source) return;
    setActiveReaderTarget({
      game_key: entry.game_key,
      appid: entry.appid,
      game_name: entry.game_name,
      game_image: entry.game_image,
      source: entry.active_source,
      guide_id: entry.active_guide_id,
      guide_title: entry.active_guide_title,
      guide_author: entry.active_guide_author,
      view_mode: "browser",
      bookmarked: entry.bookmarked,
    });
    setShowSavedDrawer(false);
  };

  const savedList = games.filter((g) => g.active_guide_id);

  const headerControls = (
    <>
      <div style={{ width: "36px", flexShrink: 0 }}>
        <DialogButton
          onClick={() => Navigation.NavigateBack()}
          style={{
            width: "100%",
            minWidth: 0,
            padding: "5px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FaSteam size={13} />
        </DialogButton>
      </div>
      <div style={{ width: "76px", flexShrink: 0 }}>
        <DialogButton
          onClick={() => setShowSavedDrawer((prev) => !prev)}
          style={{
            width: "100%",
            minWidth: 0,
            padding: "5px 4px",
            fontSize: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            backgroundColor: showSavedDrawer
              ? "rgba(102, 192, 244, 0.28)"
              : undefined,
          }}
        >
          <FaBookmark size={9} />
          <span>{s.savedCountLabel(savedList.length)}</span>
        </DialogButton>
      </div>
    </>
  );

  return (
    <div
      style={{
        position: "relative",
        padding: "42px 8px 34px 8px",
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0e141b",
        color: "#dcdedf",
      }}
    >
      {/* Main Full-Area Live Browser */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {activeTarget ? (
          <EmbeddedBrowser
            target={activeTarget}
            loadKey={targetLoadVersion}
            compact={false}
            suspended={showSavedDrawer}
            headerLeft={headerControls}
            onProgressSaved={refreshLibrary}
          />
        ) : (
          <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px" }}>
              {headerControls}
            </Focusable>
            <div style={{ color: "#8f98a0", fontSize: "13px" }}>
              {s.fullReaderEmptyBefore}
              <strong>{s.tabSaved}</strong>
              {s.fullReaderEmptyAfter}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Saved / Recent Games Drawer Overlay (hidden by default so webpage gets maximum space) */}
      {showSavedDrawer ? (
        <Focusable
          onCancelButton={() => setShowSavedDrawer(false)}
          style={{
            position: "absolute",
            top: "82px",
            left: "10px",
            width: "300px",
            maxHeight: "calc(100vh - 130px)",
            zIndex: 50,
            backgroundColor: "#171d25",
            border: "1px solid rgba(102, 192, 244, 0.45)",
            borderRadius: "8px",
            padding: "10px",
            boxShadow: "0 10px 28px rgba(0,0,0,0.65)",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "2px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#66c0f4" }}>
              {s.savedAndRecentDrawer(savedList.length)}
            </span>
            <div style={{ width: "28px" }}>
              <DialogButton
                onClick={() => setShowSavedDrawer(false)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaTimes size={10} />
              </DialogButton>
            </div>
          </div>

          {savedList.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#8f98a0", padding: "6px 0" }}>
              {s.noSavedGamesShort}
            </div>
          ) : (
            savedList.map((entry) => {
              const isActive = activeTarget?.game_key === entry.game_key;
              return (
                <DialogButton
                  key={entry.game_key}
                  onClick={() => handleSelectSaved(entry)}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    textAlign: "left",
                    padding: "7px 9px",
                    backgroundColor: isActive
                      ? "rgba(102, 192, 244, 0.25)"
                      : "rgba(255,255,255,0.04)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#fff",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.bookmarked ? "★ " : ""}
                    {entry.game_name}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#8f98a0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <FaPlay size={8} style={{ marginRight: "4px" }} />
                    {entry.active_guide_title || entry.section_title}
                  </div>
                </DialogButton>
              );
            })
          )}
        </Focusable>
      ) : null}
    </div>
  );
};
