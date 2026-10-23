# Parkeerdataviewer op de Hetzner-VPS (Coolify)

Draait als Coolify-resource (build pack **Docker Compose**, `docker-compose.yaml`
in de repo-root) op `prototype.transportlab.app/parkeerdataviewer`. Zelfde opzet
als laadpalenviewer: Nginx Proxy Manager staat ervoor en praat over het gedeelde
`coolify`-netwerk met een vaste alias.

```
NPM (prototype.transportlab.app)
  └─ location /parkeerdataviewer  ->  http://parkeerdataviewer:80   (alias van service `web`, geen URI-rewrite)
        web (nginx)
        ├─ /parkeerdataviewer/data/*  -> volume parking-public (live)
        └─ de rest                    -> app-parkeerdataviewer:3000 (Next.js)
                                          ├─ /api/v1/history/{uuid}, /api/v1/snapshots/{date} lezen parking-state/history.db
                                          └─ /api/v1/facilities, municipalities, export lezen parking-public
worker (deploy/scheduler.py)
  ├─ elk uur :05      scripts/fetch_parking_data.py -> parking-public + history.db
  └─ 's nachts 03:30  backup history.db -> parking-state/backups (14 bewaard)
```

Wat er anders is dan op Vercel:

| | Vercel + GitHub Action | Coolify |
|---|---|---|
| Data ophalen | Action commit elk uur naar `main` (GitHub-cron haalde in de praktijk ~5 runs per dag) | worker draait elk uur, schrijft direct naar een volume |
| Publiceren | elke datacommit = volledige Vercel-deploy | niets: nginx serveert de bestanden live; alleen code-pushes deployen |
| Uurhistorie | `public/data/snapshots/YYYY/MM/DD.json` in git (~7 MB/maand, groeit in de repo) | `history.db` (SQLite, ~26 MB/jaar), nooit meer in git |
| Bezettingsgrafiek | browser haalt tot 365 hele dagbestanden op (1 jaar ≈ 80 MB) | `/api/v1/history/{uuid}?days=N`: één request, alleen die garage |
| Historische export | `/data/snapshots/...` | `/api/v1/snapshots/YYYY-MM-DD` (zelfde formaat) |
| Schrijven | gewone `open("w")` | atomisch (tmp + rename), nginx ziet nooit een half bestand |
| RDW-storing | lege/halve data werd gecommit | < 50% respons = run afgebroken, vorige data blijft staan |
| Gemeentebestanden | hernoemde gemeentes bleven als oud bestand staan | verouderde bestanden worden opgeruimd |
| PDOK reverse-geocoding | elke run opnieuw | gecachet in parking-cache |
| Cache | `max-age=300` | `no-cache` + ETag (altijd vers, 304 als ongewijzigd) |

## Coolify-instellingen

- Resource `parkeerdataviewer`, GitHub App, branch `main`, compose `/docker-compose.yaml`, geen domein.
- **Advanced → Consistent container names aan, custom internal name `parkeerdataviewer`**
  → containers heten `web-`, `app-`, `worker-parkeerdataviewer` (de scripts hier rekenen daarop).
- Environment variables: `GITHUB_TOKEN` (feedbackformulier → GitHub-issues), optioneel
  `GITHUB_REPO`, `NEXT_PUBLIC_UMAMI_SRC`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID`,
  `NEXT_PUBLIC_THUNDERFOREST_API_KEY` (zonder key is de Transport-laag verborgen).
  `NEXT_PUBLIC_*` zijn build args: na wijzigen opnieuw deployen.
- NPM: proxy host `prototype.transportlab.app`, custom location `/parkeerdataviewer`
  → `http` `parkeerdataviewer` `80`. Pas toevoegen als de container draait
  (`docker exec nginx-proxy-manager-app-1 getent hosts parkeerdataviewer`), anders valt de hele proxy host weg.

## Scripts

| | |
|---|---|
| `deploy/reload-proxy.sh` | NPM herladen na een redeploy (NPM onthoudt het oude IP van `web` → 502) |
| `deploy/migrate-history.sh` | alle dagbestanden die ooit in git stonden mergen in de live `history.db` (herhaalbaar, vult alleen gaten) |

Op de server:

```sh
docker exec worker-parkeerdataviewer python deploy/scheduler.py run     # nu een fetch
docker exec worker-parkeerdataviewer python deploy/scheduler.py stats   # rijen + datumbereik
docker exec worker-parkeerdataviewer python deploy/scheduler.py backup
docker logs -f worker-parkeerdataviewer
```

## Lokaal

```sh
pip install -r scripts/requirements.txt
python scripts/fetch_parking_data.py            # schrijft webapp/public/data + data/history.db
cd webapp && PARKING_HISTORY_DB=../data/history.db npm run dev
```

Volledige stack lokaal (zoals op de VPS, vanaf lege volumes):

```sh
docker network create coolify
docker compose -p pdvtest -f docker-compose.yaml -f override.yaml up -d --build
# override.yaml: web.ports ["8088:80"] en app.networks.default.aliases [app-parkeerdataviewer]
docker compose -p pdvtest down -v && docker network rm coolify
```
