# 插件与扩展

CyberSandbox 的基础镜像保持最小化。字典、nuclei 模板、YARA 规则、恶意软件分析工具、编辑器主题等一切按需通过内置插件管理器 **csbx** 安装。

这样镜像体积可控、构建可复现,每个任务只拉取真正需要的内容。

## csbx 工作原理

所有插件都登记在公开注册表(`ProwlrBot/csbx-registry`)中,按类型标注:

- `wordlist` — SecLists、PayloadsAllTheThings、FuzzDB 等
- `nuclei-templates` — 官方/社区模板包
- `config` — 预制工具配置(nuclei、httpx、katana 等)
- `theme` — 编辑器与终端主题
- `yara-rules` — 恶意软件检测规则集
- `sigma` — 日志与 EDR 检测规则

安装命令统一为:

```bash
csbx install <plugin-name>
csbx list            # 已安装插件
csbx update <name>   # 从上游刷新
csbx remove <name>
```

插件安装到容器内 `/opt/cybersandbox/plugins/<name>/`。

## 恶意软件分析工具

镜像内置一个一键安装脚本:

```bash
docker exec -it cybersandbox \
  bash /opt/cybersandbox/scripts/install-malware-tools.sh
```

包含:

| 工具 | 用途 |
| --- | --- |
| `yara` + `yara-python` | 基于签名的恶意软件检测 |
| `capa` (flare-capa) | PE / ELF / .NET 能力识别 |
| `oletools` | Office 文档分析(olevba、oleid、rtfobj) |
| `pefile`、`lief` | Python 环境下的 PE / ELF 静态解析 |
| `exiftool` | 提取任意二进制/文档的元数据 |
| `rizin` | 逆向工程框架 |
| `upx` | 解压 UPX 加壳程序 |
| `dnsrecon`、`dnspython` | 针对 C2 / IOC 的 DNS 分析 |

工具安装后,通过 csbx 拉取规则集:

```bash
csbx install yara-rules-community
csbx install signature-base
csbx install capa-rules
csbx install sigma
csbx install misp-warninglists
```

典型分析流程:

```bash
sha256sum sample.exe
exiftool sample.exe
capa sample.exe
yara -r /opt/cybersandbox/plugins/yara-rules-community/rules sample.exe
olevba suspicious.docm
upx -d packed.exe -o unpacked.exe
rizin -A unpacked.exe
```

## 字典

```bash
csbx install seclists
csbx install payloadsallthethings
csbx install fuzzdb
csbx install assetnote-wordlists
```

## Nuclei 模板

```bash
csbx install nuclei-templates
csbx install nuclei-templates-geeknik
csbx install nuclei-fuzzing-templates
```

## 配置与主题

```bash
csbx install nuclei-config
csbx install httpx-config
csbx install theme-dracula
csbx install theme-tokyonight
```

## 贡献插件

插件本身是一段 YAML。向 [`ProwlrBot/csbx-registry`](https://github.com/ProwlrBot/csbx-registry) 提交 PR 即可,格式:

```yaml
plugins:
  - name: your-plugin-name
    type: wordlist
    description: 一句话描述
    url: https://github.com/you/your-repo
    license: MIT
    install:
      method: git
      ref: main
```

规则:

- 在 `type` 分组内按字母排序
- 许可证必须与 OSS 兼容(MIT / Apache-2.0 / BSD / GPL 系)
- 注册表中不放二进制,只指向上游
- 规则集类插件(`yara-rules`、`sigma`)必须对应积极维护的上游

完整流程见 [`csbx-registry/CONTRIBUTING.md`](https://github.com/ProwlrBot/csbx-registry/blob/main/CONTRIBUTING.md)。

## 路线图

- `sigma` → 原生转换到 Splunk / Elastic / Sentinel
- `opencti-client` 插件 — 将 YARA / capa 结果以 STIX 2.1 格式推送到 OpenCTI
- `caido-plugins` — 预打包的 Caido 插件集合

关注 [CyberSandbox changelog](https://github.com/ProwlrBot/CyberBox/releases) 获取新插件进展。
