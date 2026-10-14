(function (root) {
  "use strict";
  function normalizeSummary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("总结返回格式错误：需要包含标题和正文的对象，请重试。");
    if (typeof value.text !== "string") throw new Error("总结正文缺失：AI 没有返回 text 文本，请重新生成。");
    const text = value.text.trim();
    if (!text) throw new Error("总结正文为空，请重新生成。");
    const title = typeof value.title === "string" ? value.title.trim().replace(/^#+\s*/, "").replace(/\s+/g," ").trim() : "";
    return { title: title || "讨论总结", text };
  }
  function parseSummary(raw) {
    let value;
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "")); }
    catch { throw new Error("总结返回格式错误：AI 未返回可解析的 JSON，请重新生成。"); }
    return normalizeSummary(value);
  }
  const api = { parseSummary, normalizeSummary };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMAISummary = api;
})(typeof window === "object" ? window : globalThis);
