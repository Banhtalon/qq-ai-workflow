# Owner Status Contract
acceptance.
acceptance.
Every Owner update must fit this structure and avoid code/test jargon unless
the Owner asks for detail.

```text
STATUS: WAITING_FOR_OWNER | READY_FOR_OWNER_TEST | DONE | BLOCKED

Bạn yêu cầu:
<one or two plain-language sentences>

Hệ thống đã xác nhận:
<observable behavior and safety boundary>

Bạn cần làm:
<NONE, try named behavior, or perform an account-only action in official UI>

Không cần bạn làm:
<technical duties explicitly kept away from Owner>

Giới hạn hiện tại:
<local/CI/hosted/live distinction and any remaining blocker>
```

Rules:

- never ask Owner to inspect code, SQL, CI, security controls, or logs;
- never ask Owner to send a secret, token, password, cookie, JWT, or browser
  state;
- state exactly what the Owner can observe and what remains unproven;
- route technical actions to the Technical Operator;
- `DONE` is allowed only after deterministic and required Owner acceptance.
