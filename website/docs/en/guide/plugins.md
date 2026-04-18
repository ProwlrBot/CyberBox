# Plugins & Extensions

CyberSandbox ships with a minimal base image. Everything else — wordlists, nuclei templates, YARA rules, malware triage tools, editor themes — installs on demand through **csbx**, the built-in plugin manager.

This keeps the image small, builds reproducible, and lets you pull only what a given job actually needs.

## How csbx Works

Every plugin is declared in a public registry (`ProwlrBot/csbx-registry`) as a typed entry:

- `wordlist` — SecLists, PayloadsAllTheThings, FuzzDB, …
- `nuclei-templates` — vendor / community template packs
- `config` — prebuilt tool configs (nuclei, httpx, katana, …)
- `theme` — editor and terminal themes
- `yara-rules` — malware detection rule sets
- `sigma` — detection rules for logs and EDR

Install is always the same shape:

```bash
csbx install <plugin-name>
csbx list            # what's installed
csbx update <name>   # refresh from upstream
csbx remove <name>
```

Plugins land under `/opt/cybersandbox/plugins/<name>/` inside the container.

## Malware Triage Tools

A first-class install script is bundled with the image:

```bash
docker exec -it cybersandbox \
  bash /opt/cybersandbox/scripts/install-malware-tools.sh
```

What you get:

| Tool | Purpose |
| --- | --- |
| `yara` + `yara-python` | Signature-based malware detection |
| `capa` (flare-capa) | Capability detection for PE / ELF / .NET |
| `oletools` | OLE / Office document triage (olevba, oleid, rtfobj) |
| `pefile`, `lief` | Static PE / ELF parsing from Python |
| `exiftool` | Metadata extraction from any binary / document |
| `rizin` | Reverse-engineering framework |
| `upx` | Unpack UPX-packed binaries |
| `dnsrecon`, `dnspython` | DNS triage for C2 / IOC pivots |

After the tools are installed, pull rule sets via csbx:

```bash
csbx install yara-rules-community   # YARA-Rules/rules
csbx install signature-base          # Neo23x0/signature-base (APT, webshells, hack tools)
csbx install capa-rules              # mandiant/capa-rules
csbx install sigma                   # SigmaHQ/sigma
csbx install misp-warninglists       # MISP/misp-warninglists (FP reduction)
```

Typical triage session:

```bash
# Hash + metadata
sha256sum sample.exe
exiftool sample.exe

# Static capability extraction
capa sample.exe

# Rule scan
yara -r /opt/cybersandbox/plugins/yara-rules-community/rules sample.exe
yara -r /opt/cybersandbox/plugins/signature-base/yara sample.exe

# Office document triage
olevba suspicious.docm
oleid suspicious.docm

# Unpack + disassemble
upx -d packed.exe -o unpacked.exe
rizin -A unpacked.exe
```

## Wordlists

```bash
csbx install seclists               # danielmiessler/SecLists
csbx install payloadsallthethings   # swisskyrepo/PayloadsAllTheThings
csbx install fuzzdb                 # fuzzdb-project/fuzzdb
csbx install assetnote-wordlists    # assetnote/commonspeak2-wordlists
```

Installed at `/opt/cybersandbox/plugins/<name>/` — reference them directly from ffuf, feroxbuster, dirsearch, etc.

## Nuclei Templates

```bash
csbx install nuclei-templates         # projectdiscovery/nuclei-templates (official)
csbx install nuclei-templates-geeknik # geeknik/the-nuclei-templates
csbx install nuclei-fuzzing-templates # projectdiscovery/fuzzing-templates
```

Point nuclei at any installed pack:

```bash
nuclei -t /opt/cybersandbox/plugins/nuclei-templates/ -u https://target
```

## Configs & Themes

```bash
csbx install nuclei-config    # tuned severity + rate-limit defaults
csbx install httpx-config     # TLS + retry profile
csbx install theme-dracula    # terminal + code-server theme
csbx install theme-tokyonight
```

## Contributing a Plugin

Plugins are just YAML entries. Open a PR against [`ProwlrBot/csbx-registry`](https://github.com/ProwlrBot/csbx-registry) with an entry like:

```yaml
plugins:
  - name: your-plugin-name
    type: wordlist               # or yara-rules, nuclei-templates, config, theme, sigma
    description: One-line description.
    url: https://github.com/you/your-repo
    license: MIT
    install:
      method: git                # git | tarball | pip
      ref: main                  # optional pinned ref
```

Rules:

- Alphabetical order within each `type` block.
- License must be OSS-compatible (MIT / Apache-2.0 / BSD / GPL variants).
- No binaries in the registry itself — only pointers to upstream sources.
- Rule-set plugins (`yara-rules`, `sigma`) should have an upstream that is actively maintained.

See [`csbx-registry/CONTRIBUTING.md`](https://github.com/ProwlrBot/csbx-registry/blob/main/CONTRIBUTING.md) for the full contribution flow.

## Roadmap

- `sigma` → `sigma-cli` + native conversion to Splunk / Elastic / Sentinel
- `opencti-client` plugin — push YARA / capa findings straight into an OpenCTI instance as STIX 2.1 observables
- `caido-plugins` — prebuilt Caido plugin bundles for request modification and triage

Watch the [CyberSandbox changelog](https://github.com/ProwlrBot/CyberBox/releases) for new plugins as they land.
