import { definePlugin, routerHook } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { FC, useEffect, useRef } from "react";
import { FaBookmark, FaBookOpen, FaCog, FaSearch } from "react-icons/fa";
import { FULL_READER_ROUTE } from "./api";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { FullReaderPage } from "./pages/FullReaderPage";
import { setQamTab, useSharedStore } from "./state";

const HeaderTabBar: FC = () => {
  const { activeTab, qamChromeHidden } = useSharedStore();
  const barRef = useRef<HTMLDivElement | null>(null);
  const shouldHideHeader = qamChromeHidden && activeTab === "reader";

  useEffect(() => {
    const root = barRef.current;
    if (!root) return;

    let parent: HTMLElement | null = root.parentElement;
    let backBtn: HTMLElement | null = null;
    let headerRow: HTMLElement | null = null;

    for (let i = 0; i < 4 && parent; i++) {
      const btn = parent.querySelector("button");
      if (btn && !root.contains(btn)) {
        backBtn = btn;
        headerRow = parent;
        break;
      }
      parent = parent.parentElement;
    }

    if (backBtn) {
      backBtn.setAttribute("data-qw-x", "1");
    }
    if (headerRow) {
      headerRow.setAttribute("data-qw-header", "1");
      headerRow.style.display = shouldHideHeader ? "none" : "";
    }

    return () => {
      backBtn?.removeAttribute("data-qw-x");
      if (headerRow) {
        headerRow.style.display = "";
        headerRow.removeAttribute("data-qw-header");
      }
    };
  }, [shouldHideHeader]);

  return (
    <div
      ref={barRef}
      style={{
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
      }}
    >
      <style>{`
        button[data-qw-x="1"] svg {
          display: none !important;
        }
        button[data-qw-x="1"]::after {
          content: "✕";
          font-size: 13px;
          font-weight: 700;
          line-height: 1;
          color: inherit;
        }
        [data-qw-header="1"] {
          padding-bottom: 2px !important;
          margin-bottom: 0 !important;
          min-height: 0 !important;
        }
      `}</style>
      <Focusable
        flow-children="horizontal"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, height: "28px" }}>
          <DialogButton
            onClick={() => setQamTab("library")}
            style={{
              width: "100%",
              minWidth: 0,
              height: "28px",
              minHeight: "28px",
              padding: "0 6px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              backgroundColor:
                activeTab === "library" ? "rgba(102, 192, 244, 0.28)" : undefined,
            }}
          >
            <FaBookmark size={9} />
            <span>Đã lưu</span>
          </DialogButton>
        </div>
        <div style={{ flex: 1, minWidth: 0, height: "28px" }}>
          <DialogButton
            onClick={() => setQamTab("search")}
            style={{
              width: "100%",
              minWidth: 0,
              height: "28px",
              minHeight: "28px",
              padding: "0 6px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              backgroundColor:
                activeTab === "search" ? "rgba(102, 192, 244, 0.28)" : undefined,
            }}
          >
            <FaSearch size={9} />
            <span>Tìm</span>
          </DialogButton>
        </div>
        <div style={{ width: "30px", flexShrink: 0, height: "28px" }}>
          <DialogButton
            onClick={() => setQamTab("settings")}
            style={{
              width: "100%",
              minWidth: 0,
              height: "28px",
              minHeight: "28px",
              padding: "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                activeTab === "settings" ? "rgba(102, 192, 244, 0.28)" : undefined,
            }}
          >
            <FaCog size={11} />
          </DialogButton>
        </div>
      </Focusable>
    </div>
  );
};

export default definePlugin(() => {
  routerHook.addRoute(FULL_READER_ROUTE, FullReaderPage, {
    exact: true,
  });

  return {
    name: "Quick Walkthrough",
    alwaysRender: true,
    titleView: <HeaderTabBar />,
    content: <QuickAccessPanel />,
    icon: <FaBookOpen />,
    onDismount() {
      routerHook.removeRoute(FULL_READER_ROUTE);
    },
  };
});
