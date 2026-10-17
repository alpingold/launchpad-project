# Deploying BoilerGames (milestone M8)

One server on AWS EC2 runs everything:

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

## 1. The server (AWS console)

1. **Launch an EC2 instance:** Ubuntu Server 24.04 LTS, 64-bit **x86** (not Arm: the
   generator's Docker image and OpenShell are built for x86).
   - **Size:** at least **4 GB of memory** if AI generation runs here: Docker, a sandbox and
     a headless browser (the checker) run during each job. The site alone fits in 1 GB.
     Pick a type the launch screen marks **Free tier eligible**.
   - **Disk:** 30 GB (gp3). Docker images take a few GB.
   - **Key pair:** create one and keep the `.pem` file; it's how you log in.
2. **Security group (the firewall):** allow inbound **22** (SSH, from *My IP* only), **80** and
   **443** (from anywhere). Port 3000 stays closed: only Caddy talks to Node.
3. **Elastic IP:** allocate one and associate it with the instance, so the address survives a
   stop/start. (AWS bills public IPv4 addresses; check whether your free tier covers it.)
4. **Domain:** at your domain's DNS provider, add an **A record** pointing your domain
   (or a subdomain like `play.yourdomain.com`) to the Elastic IP. Check it from your PC:
   `nslookup play.yourdomain.com` should show the IP. HTTPS (step 5) only works once it does.

## 2. Log in and install the basics

```bash
ssh -i ~/path/to/key.pem ubuntu@<elastic-ip>

sudo apt update && sudo apt upgrade -y
# Node 24 (the version we develop with; Ubuntu's own is too old)
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh   # read it first
sudo bash nodesource_setup.sh && sudo apt install -y nodejs build-essential git
node --version   # v24.x
```

`build-essential` is there because better-sqlite3 may need to compile on install.

## 3. The code

```bash
git clone https://github.com/alpingold/launchpad-project.git ~/boilergames
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
(the secret that opens saved API keys). **Never commit or share `key-secret`.**

## 5. Caddy (HTTPS)

```bash
sudo apt install -y caddy
sed 's/play.example.com/play.yourdomain.com/' deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Open `https://play.yourdomain.com` on your phone **on mobile data** (not Wi-Fi): that's the
real test that it works from anywhere. If the certificate fails, `journalctl -u caddy` says
why (almost always: the DNS record doesn't point here yet, or port 80/443 is closed).

**Make yourself admin:** sign up on the site, then on the server:
`cd ~/boilergames && npm run admin -- grant <your-username>`.

## 6. AI generation (Docker + OpenShell)

The same as on your PC (`generator/README.md`, "One-time setup"), minus the WSL parts:

```bash
sudo apt install -y docker.io docker-buildx
sudo usermod -aG docker ubuntu   # then log out and back in
docker run --rm hello-world
# OpenShell: download install.sh from github.com/NVIDIA/OpenShell, read it, run it with sh
openshell status
openshell profile import -f generator/openshell/genai-studio.yaml
docker build -f generator/Dockerfile -t boilergames-generator:local .
```

Then set `GENERATION_ENABLED=1` in `/etc/boilergames.env` and
`sudo systemctl restart boilergames`.

Every user's job runs on **their own key** (saved on /account). Admins without a saved key use
a shared `genai-studio` provider, so either save your key on /account like everyone else
(simplest), or create that provider with step 4 of `generator/README.md`.

## 7. Backups

```bash
chmod +x ~/boilergames/deploy/backup.sh
crontab -e     # add this line: every night at 4:00
0 4 * * * /home/ubuntu/boilergames/deploy/backup.sh
```

Backups go to `~/backups` (14 days kept), with a copy of `key-secret`. They're on the same
machine, so also download one now and then:
`scp -i key.pem ubuntu@<elastic-ip>:backups/boilergames-<date>.db .`

## Updating the site

```bash
cd ~/boilergames && git pull
npm --prefix server ci --omit=dev && npm --prefix client ci && npm run build
sudo systemctl restart boilergames
```

A restart ends every open room (plan §9 risks), so update when nobody is playing. Database
changes run by themselves on start, with a backup first.
