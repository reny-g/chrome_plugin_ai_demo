// config-loader.js — 通用 JSON 配置加载工具
// 在扩展自身页面（options / sidepanel）中读取扩展自带的 JSON 配置文件。
// 因为是扩展页面读取自身打包资源（同源），无需 web_accessible_resources。

async function loadJsonConfig(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`配置文件加载失败: ${path} (HTTP ${response.status})`);
  }
  return response.json();
}

self.loadJsonConfig = loadJsonConfig;
