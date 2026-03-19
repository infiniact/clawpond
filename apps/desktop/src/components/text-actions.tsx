"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { IconCopy, IconFile, IconShare } from "./icons";

interface TextActionMenuProps {
  text: string;
  onClose?: () => void;
}

/**
 * 文本操作菜单组件
 * 提供复制、导出PDF、微信分享功能
 */
export function TextActionMenu({ text, onClose }: TextActionMenuProps) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // 复制到剪贴板
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose?.();
      }, 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text, onClose]);

  // 导出为 PDF
  const handleExportPDF = useCallback(async () => {
    setExporting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("export_text_to_pdf", { text });
      onClose?.();
    } catch (err) {
      console.error("Failed to export PDF:", err);
      alert("导出 PDF 失败: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }, [text, onClose]);

  // 微信分享
  const handleWeChatShare = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("share_to_wechat", { text });
      onClose?.();
    } catch (err) {
      console.error("Failed to share to WeChat:", err);
      alert("微信分享失败: " + (err as Error).message);
    }
  }, [text, onClose]);

  return (
    <div
      ref={menuRef}
      className="inline-flex items-center gap-1 rounded-lg bg-bg-deep px-1.5 py-1 shadow-lg ring-1 ring-border-default"
    >
      <button
        onClick={handleCopy}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/15"
        title="复制"
      >
        <IconCopy size={12} />
        {copied ? "已复制" : "复制"}
      </button>

      <button
        onClick={handleExportPDF}
        disabled={exporting}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
        title="导出 PDF"
      >
        <IconFile size={12} />
        {exporting ? "导出中..." : "PDF"}
      </button>

      <button
        onClick={handleWeChatShare}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
        title="微信分享"
      >
        <IconShare size={12} />
        微信
      </button>
    </div>
  );
}

/**
 * 带操作按钮的文本容器
 * 鼠标悬停时显示操作菜单
 */
export function TextWithActions({ 
  children, 
  text,
  className = ""
}: { 
  children: React.ReactNode; 
  text: string;
  className?: string;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    
    if (selectedText && selection && containerRef.current?.contains(selection.anchorNode as Node)) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      
      setMenuPos({
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top - 8
      });
      setShowMenu(true);
    } else {
      setShowMenu(false);
    }
  }, []);

  const handleMouseDown = useCallback(() => {
    setShowMenu(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onMouseUp={handleMouseUp}
      onMouseDown={handleMouseDown}
    >
      {children}
      
      {showMenu && (
        <div
          className="absolute z-50"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            transform: "translate(-50%, -100%)"
          }}
        >
          <TextActionMenu 
            text={window.getSelection()?.toString().trim() || text}
            onClose={() => setShowMenu(false)}
          />
        </div>
      )}
    </div>
  );
}
