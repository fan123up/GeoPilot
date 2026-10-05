# Docker images on GHCR

This repo publishes three Docker images to GitHub Container Registry (GHCR):

- geopilot-frontend: Next.js frontend
- geopilot-backend: FastAPI backend
- geopilot-nginx: Reverse proxy

Images are located under ghcr.io/<owner>/<image> where <owner> is the GitHub org or user.

## Tags

The workflow creates tags automatically:

- latest: on the default branch and tag builds only
- <branch name>: for branch builds (feature branches build only; not pushed)
- pr-<number>: for pull requests (build only; not pushed)
- vX.Y.Z and X.Y: on version tag pushes
- sha-<shortsha>: content-addressable tag (pushed only on default-branch/tag pushes)

## Pull examples

Replace <owner> with your GitHub organization/user:

- ghcr.io/<owner>/geopilot-frontend:latest
- ghcr.io/<owner>/geopilot-backend:latest
- ghcr.io/<owner>/geopilot-nginx:latest

To pull:

```
# optional: authenticate if images are private
# echo $GHCR_TOKEN | docker login ghcr.io -u <username> --password-stdin

docker pull ghcr.io/<owner>/geopilot-frontend:latest
```

## Pushing manually

Normally CI pushes on merge. If pushing locally, make sure you are logged in and then:

```
docker build -t ghcr.io/<owner>/geopilot-backend:dev ./backend
docker push ghcr.io/<owner>/geopilot-backend:dev
```
