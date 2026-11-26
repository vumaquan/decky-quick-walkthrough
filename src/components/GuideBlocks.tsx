import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { FC, Fragment, useState } from "react";
import { FontSizeOption, GuideBlock } from "../types";

interface GuideBlocksProps {
  blocks: GuideBlock[];
  fontSize: FontSizeOption;
  hideSpoilers: boolean;
  highlightQuery?: string;
}

const FONT_SIZE_PX: Record<FontSizeOption, number> = {
  small: 12,
  medium: 14,
  large: 16,
};

function renderHighlightedText(text: string, query?: string) {
  const q = query?.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return (
    <>
      {parts.map((part, idx) =>
        idx % 2 === 1 ? (
          <mark
            key={idx}
            style={{
              backgroundColor: "#f5c542",
              color: "#111",
              padding: "0 2px",
              borderRadius: "2px",
            }}
          >
            {part}
          </mark>
        ) : (
          <Fragment key={idx}>{part}</Fragment>
        )
      )}
    </>
  );
}

const SpoilerBlock: FC<{
  text: string;
  fontSizePx: number;
  initiallyHidden: boolean;
  highlightQuery?: string;
}> = ({ text, fontSizePx, initiallyHidden, highlightQuery }) => {
  const [revealed, setRevealed] = useState(!initiallyHidden);

  return (
    <DialogButton
      onClick={() => setRevealed((prev) => !prev)}
      style={{
        width: "100%",
        minWidth: 0,
        textAlign: "left",
        padding: "8px 10px",
        margin: "6px 0",
        borderRadius: "6px",
        backgroundColor: revealed ? "rgba(255,255,255,0.08)" : "rgba(255,180,50,0.12)",
        border: "1px solid rgba(255,180,50,0.35)",
        fontSize: `${fontSizePx}px`,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
      }}
    >
      {revealed ? (
        <span>
          <strong style={{ color: "#f5c542", marginRight: "6px" }}>[Spoiler]</strong>
          {renderHighlightedText(text, highlightQuery)}
        </span>
      ) : (
        <span style={{ color: "#f5c542", fontWeight: 600 }}>
          ⚠ Spoiler ẩn — Nhấn để xem nội dung
        </span>
      )}
    </DialogButton>
  );
};

const ImagePreviewModal: FC<{
  url: string;
  alt: string;
  closeModal?: () => void;
}> = ({ url, alt, closeModal }) => (
  <ModalRoot onCancel={closeModal} closeModal={closeModal}>
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
      <img
        src={url}
        alt={alt || "Guide screenshot"}
        style={{
          maxWidth: "100%",
          maxHeight: "72vh",
          objectFit: "contain",
          borderRadius: "6px",
        }}
      />
      {alt ? (
        <div style={{ fontSize: "12px", color: "#b8bcbf", textAlign: "center" }}>
          {alt}
        </div>
      ) : null}
      <DialogButton onClick={closeModal} style={{ minWidth: "140px" }}>
        Đóng
      </DialogButton>
    </div>
  </ModalRoot>
);

export const GuideBlocks: FC<GuideBlocksProps> = ({
  blocks,
  fontSize,
  hideSpoilers,
  highlightQuery,
}) => {
  const basePx = FONT_SIZE_PX[fontSize] ?? 14;

  if (!blocks || blocks.length === 0) {
    return (
      <div style={{ color: "#8f98a0", fontSize: `${basePx}px`, padding: "8px 0" }}>
        Mục này không có nội dung văn bản.
      </div>
    );
  }

  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const size =
              block.level === 1 ? basePx + 4 : block.level === 2 ? basePx + 2 : basePx + 1;
            return (
              <div
                key={index}
                style={{
                  fontSize: `${size}px`,
                  fontWeight: 700,
                  color: "#66c0f4",
                  marginTop: index === 0 ? "2px" : "8px",
                  borderBottom: "1px solid rgba(102, 192, 244, 0.25)",
                  paddingBottom: "3px",
                }}
              >
                {renderHighlightedText(block.text, highlightQuery)}
              </div>
            );
          }

          case "paragraph":
            return (
              <div
                key={index}
                style={{
                  fontSize: `${basePx}px`,
                  lineHeight: 1.5,
                  color: "#dcdedf",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {renderHighlightedText(block.text, highlightQuery)}
              </div>
            );

          case "list":
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  paddingLeft: "6px",
                }}
              >
                {block.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    style={{
                      display: "flex",
                      gap: "8px",
                      fontSize: `${basePx}px`,
                      lineHeight: 1.45,
                      color: "#dcdedf",
                    }}
                  >
                    <span style={{ color: "#66c0f4", flexShrink: 0, fontWeight: 600 }}>
                      {block.ordered ? `${itemIdx + 1}.` : "•"}
                    </span>
                    <span style={{ wordBreak: "break-word" }}>
                      {renderHighlightedText(item, highlightQuery)}
                    </span>
                  </div>
                ))}
              </div>
            );

          case "spoiler":
            return (
              <SpoilerBlock
                key={index}
                text={block.text}
                fontSizePx={basePx}
                initiallyHidden={hideSpoilers}
                highlightQuery={highlightQuery}
              />
            );

          case "quote":
            return (
              <div
                key={index}
                style={{
                  fontSize: `${basePx}px`,
                  lineHeight: 1.45,
                  color: "#c7d5e0",
                  borderLeft: "3px solid #66c0f4",
                  backgroundColor: "rgba(102, 192, 244, 0.08)",
                  padding: "6px 10px",
                  borderRadius: "0 4px 4px 0",
                  whiteSpace: "pre-wrap",
                }}
              >
                {renderHighlightedText(block.text, highlightQuery)}
              </div>
            );

          case "code":
            return (
              <pre
                key={index}
                style={{
                  fontSize: `${Math.max(11, basePx - 2)}px`,
                  lineHeight: 1.4,
                  color: "#e5e7eb",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  padding: "8px",
                  borderRadius: "4px",
                  overflowX: "auto",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {block.text}
              </pre>
            );

          case "image":
            return (
              <DialogButton
                key={index}
                onClick={() =>
                  showModal(<ImagePreviewModal url={block.url} alt={block.alt} />)
                }
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "4px",
                  backgroundColor: "rgba(0,0,0,0.25)",
                  borderRadius: "6px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <img
                  src={block.url}
                  alt={block.alt || "Walkthrough image"}
                  loading="lazy"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "220px",
                    objectFit: "contain",
                    borderRadius: "4px",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#8f98a0" }}>
                  Nhấn để phóng to ảnh
                </span>
              </DialogButton>
            );

          case "table":
            return (
              <div
                key={index}
                style={{
                  overflowX: "auto",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "4px",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: `${Math.max(11, basePx - 1)}px`,
                  }}
                >
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        style={{
                          backgroundColor:
                            rIdx === 0
                              ? "rgba(102, 192, 244, 0.16)"
                              : rIdx % 2 === 1
                              ? "rgba(255,255,255,0.03)"
                              : "transparent",
                        }}
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            style={{
                              padding: "5px 8px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              color: rIdx === 0 ? "#ffffff" : "#dcdedf",
                              fontWeight: rIdx === 0 ? 600 : 400,
                              verticalAlign: "top",
                            }}
                          >
                            {renderHighlightedText(cell, highlightQuery)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return null;
        }
      })}
    </Focusable>
  );
};
