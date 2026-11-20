# AHOLO 别墅花园可行走世界 Demo

基于 [AHOLO 快速开始](https://labs.aholo.cn/api-docs/quickstart) 与 `@manycore/aholo-sdk-world`，用 **世界生成（Spatial Gen）** 创建一座可漫游的别墅花园 3DGS 世界。

## 能力

1. `POST /world/v1/generations` 文生空间
2. 轮询 `GET /world/v1/{worldId}` 直到 `SUCCEEDED`
3. 浏览器内用 immersive 3DGS 查看器（WASD）行走

## 准备

1. 在 [API 密钥页](https://labs.aholo.cn/api-keys) 申请 key  
2. 复制环境变量：

```bash
cp .env.example .env
# 编辑 .env，填入 AHOLO_API_KEY
```

> Header 使用 `Authorization: <API key>`，**不要**加 `Bearer`。国内网关：`https://api.aholo.cn`。

## 运行

```bash
npm install
npm run generate   # 创建并等待生成（可设 WORLD_ID 续跑）
npm run dev        # http://localhost:3847
```

打开页面后会自动跟踪当前 `WORLD_ID`。成功后点 **进入花园漫游**。

## 说明

- 室外 / 非室内生成仍为 **Beta**，结果可能波动。
- 产物常见字段：`assets.splats.urls.spzPath` / `plyPath`、`assets.imagery.panoUrl`。
- 请勿把 API key 提交到公开仓库。
