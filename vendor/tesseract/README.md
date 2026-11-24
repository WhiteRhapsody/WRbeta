# 小白單（SIUS）辨識用的 OCR 引擎（自帶，不連外部 CDN）

只有在分析頁「小白單」掃描時才會下載（第一次約 7 MB：tesseract.min.js＋worker.min.js＋其中一個核心＋語言檔），之後由 service worker 快取（`wrbeta-ocr-*`，換版不刪）。

| 檔案 | 來源 | 授權 |
|---|---|---|
| tesseract.min.js、worker.min.js | npm `tesseract.js@7.0.0` dist | Apache-2.0（LICENSE-tesseract.js.md） |
| tesseract-core-{relaxedsimd-,simd-,}lstm.wasm.js | npm `tesseract.js-core`（tesseract.js 7.0.0 相依版本） | Apache-2.0（LICENSE-tesseract.js-core） |
| eng.traineddata.gz | npm `@tesseract.js-data/eng` 4.0.0_best_int（源自 tesseract-ocr/tessdata_best，Apache-2.0） | Apache-2.0 |

瀏覽器會依裝置能力自動選一個核心（relaxed SIMD → SIMD → 一般），只下載那一個。
