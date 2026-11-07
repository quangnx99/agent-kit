---
name: "indexing"
description: "Index (hoặc re-index) workspace qua Context Engine (codebase-retrieval), hiện tiến độ %. Args: [đường dẫn workspace — mặc định thư mục hiện tại] [--status]."
metadata:
  kit: osf
---

Index workspace bằng Context Engine (server của MCP `codebase-retrieval` tại http://localhost:6699).

Tham số: `$ARGUMENTS` — đường dẫn workspace (mặc định là thư mục làm việc hiện tại); thêm `--status` để chỉ xem trạng thái, không index.

`<skill-dir>` là thư mục gốc của skill này (chứa `indexing.mjs`).

Các bước:
1. Chạy bằng Bash (timeout 600000), workspace để trong nháy đơn:
   `node '<skill-dir>/indexing.mjs' '<workspace>' [--status]`
   Script gọi `POST /api/repos/{id}/index` rồi poll `/api/index-status`, mỗi lần tiến độ thay đổi thì in một dòng `phase xx% (done/total)`.
2. Script tự thêm repo chưa đăng ký vào config của engine. Nếu nó vẫn báo repo không xuất hiện (exit 2): gọi `mcp__codebase-retrieval__codebase-retrieval` một lần với `workspace_full_path` = workspace và `information_request` = "Tổng quan cấu trúc project", rồi chạy lại bước 1.
3. Nếu script chạy quá 10 phút vẫn chưa xong: chạy lại với `--status` để xem % hiện tại và báo cho người dùng.
4. Báo cáo ngắn gọn bằng tiếng Việt: các mốc tiến độ, trạng thái cuối và số file. Nếu có lỗi thì trích nguyên văn lỗi. Nếu script in dòng `⚠️ Không thấy trạng thái indexing`, đừng báo là index thành công — nói rõ không xác nhận được lần index này đã chạy.
