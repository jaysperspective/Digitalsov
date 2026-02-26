import os
from fastapi import Depends, HTTPException, Request, status

# Bearer token used for all API requests when set.
API_TOKEN = os.getenv("DIGITALSOV_API_TOKEN")


async def require_api_auth(request: Request) -> None:
    """
    Lightweight guard for all API endpoints.

    - If DIGITALSOV_API_TOKEN is set, require `Authorization: Bearer <token>`.
    - If no token is set, allow requests only from loopback addresses
      (localhost / 127.0.0.1 / ::1) to keep the default DX unchanged while
      preventing remote LAN access.
    """
    client_host = request.client.host if request.client else ""

    if API_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        prefix = "Bearer "
        if not auth_header.startswith(prefix) or auth_header[len(prefix):].strip() != API_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing API token.",
            )
        return

    # No token configured — permit only loopback requests.
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Remote access requires DIGITALSOV_API_TOKEN.",
        )


RequireAPIAuth = Depends(require_api_auth)
