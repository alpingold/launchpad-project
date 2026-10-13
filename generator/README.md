# Game generator (AI-made games)

The code here runs **inside an OpenShell sandbox**, never on the game server. It asks a
model on Purdue GenAI Studio to write a game, then tests the new code with simulated
players, all inside the sandbox (plan §11). The generator loop itself arrives in milestone
A4; for now this folder holds the sandbox setup and the A0 spike test.

```
generator/
  openshell/genai-studio.yaml   provider profile: how the sandbox uses the API key without seeing it
  openshell/policy.yaml         sandbox policy: which files it may read/write (network comes from the provider)
  spike/                        A0 test image: proves the sandbox setup works (5 checks)
```

## Models

| Model | When to use |
|---|---|
| `gpt-oss:120b` (**default**) | Fast: about 25 s per attempt in our test |
| `qwen3.8:27b` | Generally makes somewhat better games (e.g. more personal player screens), but takes much longer: about 150 s per attempt, since it "thinks" first |

Picked from an informal test on 2026-10-13: both wrote a passing "Majority Rules" game on the
first try. The A4 comparison over several game ideas will confirm it.

## One-time setup (milestone A0)

Needs Docker Engine and OpenShell on Linux / WSL 2.

1. **Docker:** `sudo apt install docker.io docker-buildx`, then `sudo usermod -aG docker $USER`,
   and restart WSL (`wsl --shutdown` from Windows). Check with `docker run --rm hello-world`.
   Being in the `docker` group is effectively root on this machine; fine for a personal dev box.
2. **OpenShell:** download `https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh`,
   read it, run it with `sh`, then check `openshell status`. If the gateway fails with
   "no compute driver", Docker isn't reachable yet (usually WSL wasn't restarted after step 1).
3. **API key:** create one at genai.rcac.purdue.edu → Settings → Account → API Keys.
4. **Provider** (from the repo root). `read -s` keeps the key off the screen and out of shell history.
   Paste the key when asked and press Enter:
   ```bash
   openshell profile import -f generator/openshell/genai-studio.yaml
   read -rsp "GenAI Studio key: " GENAI_API_KEY && export GENAI_API_KEY
   openshell provider create --name genai-studio --type genai-studio --from-existing
   unset GENAI_API_KEY
   ```
   From now on the key lives only in OpenShell's credential store. Sandboxes see a placeholder.
5. **Check everything works:**
   ```bash
   docker build -t boilergames-spike:local generator/spike
   openshell sandbox create --no-keep --from boilergames-spike:local \
     --provider genai-studio --policy generator/openshell/policy.yaml -- node /app/spike.mjs
   ```
   Expect five `PASS` lines: the key is a placeholder, GenAI Studio is reachable, a chat works,
   other websites are blocked, and `/app` is read-only.

Always pass `--policy generator/openshell/policy.yaml`: OpenShell's default policy doesn't let
the sandbox read `/app`, where our code lives.
