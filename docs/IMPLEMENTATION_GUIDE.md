# Programme Hub Cloud：实施指南

## 目标

将现有 GitHub Pages 静态网页升级为：

- 学员端：项目链接 / 二维码进入，姓名 + PIN 验证，查看日程、通知和照片。
- 管理端：邮箱密码登录，维护项目、日程、通知、相册和成员。
- 数据端：Supabase Database、Auth、Storage 和 Row Level Security。
- 发布方式：数据保存后立即生效，无需每天修改或重新上传 HTML。

## 正式地址规划

- 学员端：`https://cchn05.github.io/programme-hub/`
- 项目直达：`https://cchn05.github.io/programme-hub/?project=2026-uae`
- 管理端：`https://cchn05.github.io/programme-hub/admin/`

## 第一阶段：创建 Supabase 项目

1. 登录 Supabase Dashboard。
2. 新建项目，建议名称 `programme-hub`。
3. 选择离主要用户较近的区域。
4. 保存数据库密码，但不要放入 GitHub 或网页代码。
5. 在 Project Settings / API 中记录：
   - Project URL
   - Publishable key（旧项目可能显示 anon key）
6. 不要复制或公开 service_role / secret key。

## 第二阶段：安装数据库

1. 打开 Supabase > SQL Editor。
2. 打开仓库文件 `supabase/schema.sql`。
3. 将完整 SQL 粘贴到 SQL Editor 并运行。
4. 检查 Table Editor 中是否出现：
   - projects
   - project_home
   - admin_profiles
   - project_admins
   - members
   - schedule_items
   - notices
   - albums
   - photos

## 第三阶段：配置 Storage

在 Supabase > Storage 中建立两个 bucket：

1. `public-assets`
   - Public bucket：是
   - 用于项目 Logo、公开封面和普通装饰图片。
2. `project-photos`
   - Public bucket：否
   - 用于学员活动照片。

之后在 SQL Editor 运行 `supabase/storage-policies.sql`。

图片路径统一采用：

`<project_uuid>/<album_uuid>/<filename>.jpg`

## 第四阶段：配置 Auth

### 管理员

1. Authentication > Users > Add user。
2. 创建管理员邮箱和密码。
3. 复制该用户 UUID。
4. 在 SQL Editor 中运行：

```sql
insert into public.admin_profiles (user_id, display_name, is_super_admin)
values ('管理员用户 UUID', '管理员姓名', true);
```

### 学员

1. Authentication > Sign In / Providers。
2. 开启 Anonymous Sign-Ins。
3. 学员首次扫码时，网页自动调用匿名登录。
4. 学员输入项目、姓名和个人 PIN。
5. `claim_member()` 验证后，将匿名账号绑定到成员记录。

建议正式上线前为匿名登录配置 CAPTCHA，避免机器人重复创建匿名账号。

### URL Configuration

在 Authentication > URL Configuration 设置：

- Site URL：`https://cchn05.github.io/programme-hub/`
- Redirect URL：`https://cchn05.github.io/programme-hub/**`

正式生产可将通配符改为实际使用的精确路径。

## 第五阶段：导入项目和成员

### 新建项目

后台完成前，可以先在 Table Editor 中新增一条 projects：

- slug：`2026-uae`
- name_zh：`2026 UAE`
- name_en：`2026 UAE Summer Programme`
- status：`published`
- is_public：false

然后新增 project_home 记录，project_id 与项目 ID 一致。

### 成员 PIN

不要存储明文 PIN。生成 PIN 哈希：

```sql
select crypt('2716', gen_salt('bf'));
```

将结果填入 members.pin_hash。

成员表至少包含：

- project_id
- full_name
- login_name
- pin_hash
- group_name
- is_active

建议使用随机四位或六位 PIN，不使用护照号码或生日。

## 第六阶段：前端接入

前端需要新增：

- `config.js`：只存 Project URL 和 Publishable key。
- `supabase-client.js`：初始化 Supabase 客户端。
- 学员登录逻辑：匿名登录 + `claim_member()`。
- 数据读取逻辑：从 projects、schedule_items、notices、albums、photos 读取。
- 管理端：邮箱密码登录 + CRUD 表单 + 上传图片。

Publishable key 可以出现在前端，但前提是所有表和 Storage 都启用正确的 RLS。service_role / secret key绝不能放在前端。

## 第七阶段：管理端页面

建议栏目：

1. Dashboard
   - 今日课程数量
   - 未发布内容
   - 最新通知
   - 最近上传照片
2. 项目管理
   - 项目名称、日期、主题色、公开状态、发布状态
3. 首页管理
   - 欢迎语、天气、模块开关
4. 日程管理
   - 日期、时间、标题、地点、主讲人、排序、草稿/发布
5. 通知管理
   - 中英文内容、置顶、优先级、发布时间、失效时间
6. 相册管理
   - 新建相册、批量上传、封面、可见范围、发布
7. 成员管理
   - Excel/CSV 导入、PIN 生成、分组、停用
8. 分享
   - 项目直达链接
   - 二维码 PNG
   - 登录测试

## 第八阶段：学员端页面

流程：

1. 扫描项目二维码。
2. URL 自动识别 `project` 参数。
3. 输入姓名和 PIN。
4. 验证成功后进入 Dashboard。
5. 后续在同一浏览器中保留会话，不必每天重复登录。

栏目：

- 首页：首页课程、天气、通知、精选照片。
- 日程：按日期查看，当前活动突出。
- 通知：置顶、重要、未读标记。
- 照片：按日期和相册查看。
- 我的：姓名、项目、分组、退出。

## 第九阶段：发布与测试

至少测试：

- iPhone 微信内置浏览器
- Android 微信内置浏览器
- iPhone Safari
- Android Chrome
- 电脑 Chrome / Safari
- 弱网和图片较多的场景

测试账户应覆盖：

- 超级管理员
- 项目编辑
- 普通学员
- PIN 错误
- 已停用成员
- 已过期通知
- 草稿内容不可见
- 私密相册不可越权访问

## 日常运营流程

1. 打开 `/admin/` 并登录。
2. 选择项目。
3. 更新明日日程。
4. 发布或置顶通知。
5. 上传并整理照片。
6. 在手机预览中检查。
7. 点击发布。
8. 用项目二维码验证学员端。

数据保存后直接写入 Supabase，学员刷新页面即可看到，无需重新部署 GitHub Pages。

## 安全要求

- 前端仅使用 Publishable key。
- 永不在 GitHub 中保存 service_role / secret key、数据库密码。
- 所有 public schema 表启用 RLS。
- 活动照片放在 Private bucket。
- 不使用护照号或生日作为 PIN。
- 上传图片时建议压缩并移除 EXIF 元数据。
- 管理员关闭公共注册，账号由超级管理员创建。
- 定期导出项目、成员和内容数据作为备份。

## 上线顺序

1. 云端数据库和管理员登录。
2. 后台项目 / 日程 / 通知维护。
3. 学员端读取实时数据。
4. 相册上传和私密照片。
5. 成员名单、匿名登录和 PIN 验证。
6. 二维码与分享。
7. 自定义域名和正式品牌。
