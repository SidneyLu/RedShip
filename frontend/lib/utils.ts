/** 通用工具：cn 合并 className、日期格式化等 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value?: string | null) {
  if (!value) return "";
  try {
    const d = new Date(value);
    return d.toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function timeAgo(value?: string | null) {
  if (!value) return "";
  const t = new Date(value).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

export function truncate(text: string | undefined | null, n = 120) {
  if (!text) return "";
  if (text.length <= n) return text;
  return text.slice(0, n) + "…";
}
