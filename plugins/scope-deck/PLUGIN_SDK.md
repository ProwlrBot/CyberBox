# ScopeDeck plugin SDK

Public integration surface:

- `GET /api/health`
- `GET /api/v1/programs`
- `GET /api/v1/programs/{id}`
- `GET /api/v1/programs/{id}/score`
- `GET /api/v1/programs/compare`
- `POST /api/v1/draw`
- `POST /api/v1/source-sync`

All API responses are JSON. Mutation requests must use `application/json` and
are limited to 2 MiB. Browser requests are accepted only from the same origin.

The server defaults to `127.0.0.1:8321`; it does not provide user accounts or a
public deployment mode. The UI assets are embedded in the binary.
