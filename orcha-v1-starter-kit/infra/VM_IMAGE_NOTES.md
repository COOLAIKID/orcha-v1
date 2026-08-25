# VM Image Notes

The production company VM image should pin the OS, Python/Node runtimes, browser version, build tools, and security agent. Run agents as an unprivileged user. Mount Company Vault and Shareable storage separately. Keep Local Only outside the VM entirely.

Required image checks: no default credentials, outbound network policy loaded, metadata service blocked, secret redaction enabled, process and disk quotas active, audit forwarder healthy, kill switch reachable, and preview server isolated from control-plane credentials.
