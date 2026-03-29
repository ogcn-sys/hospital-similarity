# 病院類似度ダッシュボード

二次医療圏 PDF をもとに作成した病院類似度ダッシュボードです。GitHub Pages では `dashboard/` 配下をそのまま公開します。

## 公開対象

- `dashboard/index.html`
- `dashboard/hospital-similarity.html`
- `dashboard/styles.css`
- `dashboard/hospital-similarity.js`
- `dashboard/hospital-similarity-data.json`

## 主なコマンド

```bash
npm run fetch:hsa
npm run verify:hsa-jmap
npm run build:dashboard
npm run serve:dashboard
```

## GitHub Pages

- `main` ブランチへ push すると GitHub Actions で `dashboard/` が Pages へデプロイされます
- workflow は `.github/workflows/pages.yml` です

## 元データ

`https://nkgr.co.jp/hsa/` に掲載されている二次医療圏 PDF をもとにしています。

出典: 株式会社 日本経営 医療需給総覧 Ver 1.0
