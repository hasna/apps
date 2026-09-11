---
"@hasna/emails": patch
---

Keep the self-hosted server's idle connections open longer than the proxy idle timeout, so a load balancer closes an idle backend connection before the backend does and never reuses a socket the server has already shut down.
