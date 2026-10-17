# Deploying BoilerGames (milestone M8)

One AWS server with 2 GB (plan §28, §29) runs everything, at **https://boilergames.party**.
Today it's EC2 `t3.small` (paid from the free-plan credits); later a Lightsail server. Only
step 1 differs between the two:

```
phone / laptop ──HTTPS + wss://──▶ Caddy (:443) ──▶ node server (:3000) ──▶ SQLite file
                                                        └──▶ Docker + OpenShell (AI generation)
```

- **Caddy** is the front door. It gets the HTTPS certificate by itself (from Let's Encrypt)
  and passes everything, WebSockets included, to Node.
- **One Node process** serves the website (`client/dist`), the API and the WebSockets. systemd
  starts it at boot and restarts it if it crashes.
- **The database** is one SQLite file (`server/data/boilergames.db`), backed up every night.

Files in this folder: `Caddyfile`, `boilergames.service` (systemd), `boilergames.env.example`
(the server's settings) and `backup.sh` (the nightly backup).

## 1. The server

**EC2 (now, plan §29):** `t3.small`, Canonical's Ubuntu 24.04 x86 image, a 30 GB encrypted gp3
disk, **CPU credits "standard"** (bursts never cost extra), IMDSv2 required, your own SSH public
key imported, an Elastic IP, and a security group allowing only 22, 80 and 443. Then do step 4
below (the domain) with the Elastic IP.

**Lightsail (later, after the free plan):**

1. **Create an instance** in **Ohio (us-east-2)**: Linux/Unix, "OS Only", **Ubuntu 24.04 LTS**,
   the **$12 plan (2 GB memory, 2 vCPUs, 60 GB disk)**. 2 GB is enough for the site plus AI
   generation: we measured ~1.1 GB at the busiest moment, and browser checks take turns
   (plan §28). Download the SSH key Lightsail offers (`.pem`); it's how you log in.
2. **Static IP** (Networking tab): create one and attach it, so the address never changes.
   It's free while attached.
3. **Firewall** (the instance's Networking tab, IPv4): **SSH 22** (restricted to your own IP
   if you can), **HTTP 80**, **HTTPS 443**. Nothing else: Node's port 3000 stays closed, and
   Node only listens on the machine itself anyway (`HOST=127.0.0.1`).
4. **Domain (Cloudflare):** DNS → add an **A record**, name `@` (boilergames.party itself),
   content: the static IP, **proxy status: DNS only (grey cloud)**, so Caddy can get its own
   certificate. Check from your PC: `nslookup boilergames.party` shows the static IP.
   HTTPS (step 5) only works once it does.

## 2. Log in and install the basics

```bash
ssh -i ~/path/to/key.pem ubuntu@<static-ip>

sudo apt update && sudo apt upgrade -y
# 2 GB of swap: disk space used as spare memory if a busy moment ever needs more than 2 GB
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h          # Swap: 2.0Gi
# Node 24 (the version we develop with; Ubuntu's own is too old)
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh   # read it first
sudo bash nodesource_setup.sh && sudo apt install -y nodejs build-essential git
node --version   # v24.x
```

`build-essential` is there because better-sqlite3 may need to compile on install. Ubuntu
installs security updates by itself (unattended-upgrades); leave that on.

## 3. The code

The repo is private, so the server gets a **deploy key**: an SSH key that can only *read*
this one repo. Make it on the server, then add its public half on GitHub (repo → Settings →
Deploy keys → Add deploy key, "Allow write access" unchecked):

```bash
ssh-keygen -q -t ed25519 -N "" -C "boilergames-server deploy key (read-only)" -f ~/.ssh/github_deploy
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' > ~/.ssh/config
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
ssh-keygen -lf ~/.ssh/known_hosts   # must show SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU (GitHub's)
cat ~/.ssh/github_deploy.pub         # paste this on GitHub
```

```bash
git clone git@github.com:alpingold/launchpad-project.git ~/boilergames
cd ~/boilergames
npm --prefix server ci --omit=dev
npm --prefix client ci
npm run build                      # writes client/dist, which the server serves
```

(If the repo is private, use a GitHub deploy key or a fine-grained token with read access.)

## 4. Settings and the service

```bash
sudo cp deploy/boilergames.env.example /etc/boilergames.env
sudo chmod 600 /etc/boilergames.env
sudo nano /etc/boilergames.env    # set GENERATION_ENABLED=0 until step 6 is done
sudo cp deploy/boilergames.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now boilergames
curl localhost:3000/api/health    # {"ok":true}
journalctl -u boilergames -f      # the server's log (Ctrl+C to stop watching)
```

On first start the server creates `server/data/boilergames.db` and `server/data/key-secret`
(the secret that opens saved API keys). **Never commit or share `key-secret`.** Make the
folder private to you: `chmod 700 ~/boilergames/server/data`.

## 5. Caddy (HTTPS)

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Open `https://boilergames.party` on your phone **on mobile data** (not Wi-Fi): that's the
real test that it works from anywhere. If the certificate fails, `journalctl -u caddy` says
why (almost always: the DNS record doesn't point here yet, or port 80/443 is closed).

**Make yourself admin:** sign up on the site, then on the server:
`cd ~/boilergames && npm run admin -- grant <your-username>`.

## 6. AI generation (Docker + OpenShell)

The same as on your PC (`generator/README.md`, "One-time setup"), minus the WSL parts.
First check this server can reach GenAI Studio at all (any HTTP code is fine; a timeout
isn't): `curl -s -o /dev/null -w '%{http_code}\n' https://genai.rcac.purdue.edu/api/models`

```bash
sudo apt install -y docker.io docker-buildx
sudo usermod -aG docker ubuntu   # then log out and back in
docker run --rm hello-world
# OpenShell: the installer downloads only from NVIDIA's GitHub releases and checks their
# checksums. Pin the version the dev PC uses (`openshell --version` there; 0.1.3 at launch).
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh -o /tmp/openshell-install.sh
OPENSHELL_VERSION=v0.1.3 sh /tmp/openshell-install.sh
# Its gateway is a *user* service of ubuntu: keep it running with nobody logged in, and
# restart ubuntu's service manager so the gateway gets the new docker group (without this
# it fails with "no compute driver configured").
sudo loginctl enable-linger ubuntu
sudo systemctl restart user@$(id -u).service
openshell gateway add --local --name openshell https://127.0.0.1:17670
openshell status                  # Status: Connected
openshell profile import -f generator/openshell/genai-studio.yaml
docker build -f generator/Dockerfile -t boilergames-generator:local .
# The checker works here (headless Chromium, no network):
docker run --rm --network none -v "$PWD/server/src/games/punchline/game.html:/tmp/game.html:ro" \
  boilergames-generator:local node /app/generator/src/check/cli.js /tmp/game.html   # PASSED
```

Then set `GENERATION_ENABLED=1` in `/etc/boilergames.env` and
`sudo systemctl restart boilergames`.

Every user's job runs on **their own key** (saved on /account). Admins without a saved key use
a shared `genai-studio` provider, so either save your key on /account like everyone else
(simplest), or create that provider with step 4 of `generator/README.md`.

## 7. Backups

```bash
chmod +x ~/boilergames/deploy/backup.sh
echo "0 4 * * * /home/ubuntu/boilergames/deploy/backup.sh" | crontab -   # every night at 4:00 UTC
crontab -l                        # check it's there
~/boilergames/deploy/backup.sh && chmod 700 ~/backups && ls -l ~/backups   # try it once
```

**Last check: reboot** (`sudo systemctl reboot`). After a minute, `boilergames`, `caddy`,
`docker` and `systemctl --user is-active openshell-gateway` should all be active, and
`https://boilergames.party/api/health` should answer `{"ok":true}`.

Backups go to `~/backups` (14 days kept), with a copy of `key-secret`. They're on the same
machine, so also download one now and then:
`scp -i key.pem ubuntu@<static-ip>:backups/boilergames-<date>.db .`

## Updating the site

```bash
cd ~/boilergames && git pull
npm --prefix server ci --omit=dev && npm --prefix client ci && npm run build
docker build -f generator/Dockerfile -t boilergames-generator:local .
sudo systemctl restart boilergames
```

Always rebuild the generator image too: the server and the generator inside it talk over a
protocol (e.g. the browser slot, plan §28), so they must be the same version.

A restart ends every open room (plan §9 risks), so update when nobody is playing. Database
changes run by themselves on start, with a backup first.
