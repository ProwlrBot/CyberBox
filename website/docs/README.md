# CyberBox Documentation

This documentation provides comprehensive guides and API references for the CyberBox environment.

## 📚 Documentation Structure

```
docs/
├── index.md          # Homepage with overview
├── guide/            # User guides and tutorials
│   ├── quick-start.md
│   └── ...
├── api/              # API reference documentation
│   ├── index.md      # API overview
│   ├── swagger.md    # Interactive API docs guide
│   ├── file.md       # File operations API
│   ├── shell.md      # Shell & terminal API
│   ├── browser.md    # Browser automation API
│   └── mcp.md        # MCP services API
└── examples/         # Practical examples
    ├── agent.md
    ├── browser.md
    └── terminal.md
```

## 🚀 Viewing Documentation

### Local Development
If you're running the documentation locally:
```bash
# Install dependencies
npm install

# Start dev server
npm run docs:dev

# Build for production
npm run docs:build
```

### Live API Documentation
When CyberBox is running, access the interactive Swagger UI at:
- **Swagger UI**: http://localhost:8080/v1/docs
- **OpenAPI Spec**: http://localhost:8080/openapi.json

## 📖 Key Sections

### For Users
- **[Quick Start](/en/guide/start/quick-start)** - Get up and running in minutes
- **[Features Guide](/en/guide/start/introduction)** - Explore all capabilities
- **[Examples](/en/examples/)** - Real-world use cases

### For Developers
- **[API Reference](/en/api/)** - Complete API documentation with interactive Swagger UI

## 🛠️ API Integration

### Generate Client SDKs
Use the OpenAPI specification to generate client libraries:

```bash
# Install OpenAPI Generator
npm install -g @openapitools/openapi-generator-cli

# Generate Python client
openapi-generator-cli generate \
  -i http://localhost:8080/openapi.json \
  -g python \
  -o ./python-client

# Generate TypeScript client
openapi-generator-cli generate \
  -i http://localhost:8080/openapi.json \
  -g typescript-axios \
  -o ./typescript-client
```

### Import to API Tools
- **Postman**: Import → URL → `http://localhost:8080/openapi.json`
- **Insomnia**: Import → From URL → `http://localhost:8080/openapi.json`
- **Bruno**: Import → OpenAPI → `http://localhost:8080/openapi.json`

## 📝 Documentation Updates

The documentation is automatically generated from:
1. **OpenAPI Specification** (`/openapi.json`) - API endpoints and schemas
2. **Markdown Files** - Guides, examples, and additional content
3. **Code Comments** - Inline documentation in source code

To update documentation:
1. Modify the relevant markdown files in `/docs`
2. Update OpenAPI spec for API changes
3. Run build to generate updated docs

## 🤝 Contributing

Contributions to documentation are welcome! Please:
1. Follow the existing structure and style
2. Write from a user perspective
3. Include practical examples
4. Test all code samples
5. Update the OpenAPI spec for API changes

## 📚 Resources

- **GitHub Repository**: https://github.com/ProwlrBot/CyberBox
- **Issue Tracker**: https://github.com/ProwlrBot/CyberBox/issues
- **Docker Hub**: https://ghcr.io/prowlrbot/cybersandbox

## 📄 License

This documentation is part of the CyberBox project and follows the same license terms.
