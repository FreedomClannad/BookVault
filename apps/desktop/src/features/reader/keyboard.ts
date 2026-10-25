/**
 * 阅读器键盘快捷键的通用 guard：输入控件聚焦时不劫持按键。
 */

export function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
}
