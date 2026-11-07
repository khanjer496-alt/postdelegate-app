#!/usr/bin/env python3
"""Create root-only staging configuration without printing any value.

Writes /etc/postiz/staging.env (fresh secrets, staging URLs and addresses, no
provider, billing, email or AI keys) and /etc/postiz/staging-access (the Caddy
basic-auth login). Production's runtime.env is only read, for the few
non-secret settings staging must match. Existing files are never overwritten.
"""
from pathlib import Path
import base64
import os
import secrets

config_dir = Path('/etc/postiz')
env_path = config_dir / 'staging.env'
access_path = config_dir / 'staging-access'
image = os.environ.get('POSTIZ_IMAGE')
if not image:
    raise SystemExit('Set POSTIZ_IMAGE, e.g. postdelegate-postiz:release-<rev>.')
for path in (env_path, access_path):
    if path.exists():
        raise SystemExit(f'{path} exists; inspect it before reinitializing.')

# Non-secret production settings staging must keep identical.
production = {}
for line in (config_dir / 'runtime.env').read_text().splitlines():
    key, sep, value = line.partition('=')
    if sep and key in ('HIDDEN_PROVIDERS', 'DCR_VERIFIED_DOMAINS', 'API_LIMIT'):
        production[key] = value

url = 'https://staging.postdelegate.com'
db_password = secrets.token_hex(32)
values = {
    'MAIN_URL': url,
    'FRONTEND_URL': url,
    'NEXT_PUBLIC_BACKEND_URL': url + '/api',
    'BACKEND_INTERNAL_URL': 'http://localhost:3000',
    'JWT_SECRET': secrets.token_hex(32),
    'TOKEN_ENCRYPTION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
    'POSTIZ_DB_PASSWORD': db_password,
    'TEMPORAL_DB_PASSWORD': secrets.token_hex(32),
    'DATABASE_URL': f'postgresql://postiz:{db_password}@app-db:5432/postiz',
    'REDIS_URL': 'redis://app-redis:6379',
    'TEMPORAL_ADDRESS': 'temporal-server:7233',
    'TEMPORAL_NAMESPACE': 'default',
    'POSTIZ_IMAGE': image,
    'IS_GENERAL': 'true',
    'DISABLE_REGISTRATION': 'false',
    'NX_ADD_PLUGINS': 'false',
    'STORAGE_PROVIDER': 'local',
    'UPLOAD_DIRECTORY': '/uploads',
    'NEXT_PUBLIC_UPLOAD_DIRECTORY': '/uploads',
    'API_LIMIT': production.get('API_LIMIT', '30'),
    'HIDDEN_PROVIDERS': production.get('HIDDEN_PROVIDERS', ''),
    'DCR_VERIFIED_DOMAINS': production.get('DCR_VERIFIED_DOMAINS', ''),
    'TRUST_CF_CONNECTING_IP': 'true',
    'EMAIL_FROM_NAME': 'PostDelegate Staging',
    'RUN_CRON': 'true',
    'WEEKLY_SUMMARY_DISABLED': 'true',
    'TRIAL_ONBOARDING_EMAILS_DISABLED': 'true',
    'ANALYTICS_REPORTS_DISABLED': 'true',
}
header = """# PostDelegate STAGING. root:root 0600. Never copy production secrets here.
# Deliberately absent: every social provider ID/secret (incl. TELEGRAM_TOKEN,
# which would steal production's bot updates), STRIPE_* (billing off, paid
# features open), EMAIL_PROVIDER/RESEND_API_KEY (no mail; LOCAL signups are
# auto-activated), CLOUDFLARE_* R2 settings (local storage only), AI keys.
"""
old_umask = os.umask(0o077)
try:
    env_path.write_text(header + ''.join(f'{k}={v}\n' for k, v in values.items()))
    access_path.write_text(
        f'STAGING_BASIC_AUTH_USER=stg-{secrets.token_hex(8)}\n'
        f'STAGING_BASIC_AUTH_PASSWORD={secrets.token_urlsafe(32)}\n')
finally:
    os.umask(old_umask)
for path in (env_path, access_path):
    os.chmod(path, 0o600)
print('Root-only staging configuration created; secret values withheld.')
