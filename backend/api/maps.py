"""CRUD endpoints for maps and portable map project packages."""

import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse
from uuid import UUID
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from api.deps import get_current_user
from core.config import LOCAL_UPLOAD_DIR
from db.models.conversation import Conversation
from db.models.layer import Layer
from db.models.map import Map
from db.models.map_layer import MapLayer
from db.models.user import User
from db.session import get_session
from models.layer import LayerRead
from models.map import MapCreate, MapRead, MapUpdate, ProjectExportOptions
from models.map_layer import MapLayerItem, MapLayerRead
from services.storage.file_management import store_file

router = APIRouter(prefix="/maps", tags=["maps"])

PROJECT_FORMAT = "geopilot-project"
PROJECT_VERSION = 1


def _local_layer_file(data_link: str) -> Path | None:
    """Resolve locally stored layer URLs without allowing paths outside uploads."""
    parsed = urlparse(data_link)
    marker = "/api/stream/"
    if marker not in parsed.path:
        return None

    filename = unquote(parsed.path.split(marker, 1)[1])
    uploads_root = Path(LOCAL_UPLOAD_DIR).resolve()
    candidate = (uploads_root / filename).resolve()
    try:
        candidate.relative_to(uploads_root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


async def _get_map_for_user(
    map_id: UUID,
    db: AsyncSession,
    current_user: User,
) -> Map:
    result = await db.execute(select(Map).where(Map.id == map_id, Map.owner_id == current_user.id))
    map_obj = result.scalars().first()
    if not map_obj:
        raise HTTPException(status_code=404, detail="Map not found")
    return map_obj


@router.post("/", response_model=MapRead, status_code=status.HTTP_201_CREATED)
async def create_map(
    payload: MapCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MapRead:
    """Create a map."""
    map_obj = Map(
        name=payload.name,
        description=payload.description,
        owner_id=current_user.id,
    )
    db.add(map_obj)
    await db.commit()
    await db.refresh(map_obj)
    return MapRead.model_validate(map_obj)


@router.get("/", response_model=list[MapRead])
async def list_maps(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[MapRead]:
    """List maps."""
    result = await db.execute(
        select(Map)
        .where(Map.owner_id == current_user.id)
        .order_by(Map.name.asc())
        .limit(limit)
        .offset(offset)
    )
    return [MapRead.model_validate(item) for item in result.scalars().all()]


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_project(
    project_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create a new map from a .geopilot project package."""
    try:
        archive = ZipFile(project_file.file)
        manifest = json.loads(archive.read("project.json"))
    except (BadZipFile, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid GeoPilot project package") from exc

    if manifest.get("format") != PROJECT_FORMAT or manifest.get("version") != PROJECT_VERSION:
        raise HTTPException(status_code=400, detail="Unsupported GeoPilot project package")

    map_data = manifest.get("map") or {}
    if not isinstance(map_data.get("name"), str) or not map_data["name"].strip():
        raise HTTPException(status_code=400, detail="Project name is missing")

    try:
        map_obj = Map(
            owner_id=current_user.id,
            name=map_data["name"].strip(),
            description=map_data.get("description"),
        )
        db.add(map_obj)
        await db.flush()

        imported_layers = 0
        for item in manifest.get("layers", []):
            package_path = item.get("package_path")
            data_link = item.get("data_link", "")
            if package_path:
                if not package_path.startswith("data/"):
                    raise ValueError("Invalid packaged data path")
                content = archive.read(package_path)
                data_link, _ = store_file(Path(package_path).name, content)

            layer = Layer(
                owner_id=current_user.id,
                data_link=data_link,
                data_type=item.get("data_type") or "Layer",
                name=item.get("name") or "未命名图层",
                description=item.get("description"),
                derived=bool(item.get("derived", False)),
                style=item.get("style"),
                payload=item.get("payload"),
            )
            db.add(layer)
            await db.flush()
            db.add(
                MapLayer(
                    map_id=map_obj.id,
                    layer_id=layer.id,
                    z_index=int(item.get("z_index", imported_layers)),
                    visible=bool(item.get("visible", True)),
                )
            )
            imported_layers += 1

        imported_conversation_id = None
        conversation_data = manifest.get("conversation")
        if conversation_data:
            conversation = Conversation(
                owner_id=current_user.id,
                title=conversation_data.get("title") or "导入的对话",
                messages=conversation_data.get("messages") or [],
            )
            db.add(conversation)
            await db.flush()
            imported_conversation_id = str(conversation.id)

        await db.commit()
        return {
            "map_id": str(map_obj.id),
            "name": map_obj.name,
            "basemap": manifest.get("basemap") or {"url": "", "attribution": ""},
            "layers_imported": imported_layers,
            "conversation_id": imported_conversation_id,
        }
    except (KeyError, TypeError, ValueError) as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Project package data is invalid") from exc
    finally:
        archive.close()


@router.get("/{map_id}", response_model=MapRead)
async def get_map(
    map_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MapRead:
    """Fetch a map by id."""
    map_obj = await _get_map_for_user(map_id, db, current_user)
    return MapRead.model_validate(map_obj)


@router.post("/{map_id}/export")
async def export_project(
    map_id: UUID,
    options: ProjectExportOptions,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Download a portable .geopilot package for a map and its active chat."""
    map_obj = await _get_map_for_user(map_id, db, current_user)
    layer_result = await db.execute(
        select(MapLayer, Layer)
        .join(Layer, MapLayer.layer_id == Layer.id)
        .where(MapLayer.map_id == map_id, Layer.owner_id == current_user.id)
        .order_by(MapLayer.z_index.asc())
    )

    conversation_data = None
    if options.active_conversation_id:
        conversation_result = await db.execute(
            select(Conversation).where(
                Conversation.id == options.active_conversation_id,
                Conversation.owner_id == current_user.id,
            )
        )
        conversation = conversation_result.scalars().first()
        if conversation:
            conversation_data = {
                "title": conversation.title,
                "messages": conversation.messages,
            }

    manifest = {
        "format": PROJECT_FORMAT,
        "version": PROJECT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "map": {"name": map_obj.name, "description": map_obj.description},
        "basemap": options.basemap.model_dump(),
        "layers": [],
        "conversation": conversation_data,
    }

    package = io.BytesIO()
    with ZipFile(package, "w", ZIP_DEFLATED) as archive:
        for map_layer, layer in layer_result.all():
            layer_data = {
                "data_link": layer.data_link,
                "data_type": layer.data_type,
                "name": layer.name,
                "description": layer.description,
                "derived": layer.derived,
                "style": layer.style,
                "payload": layer.payload,
                "z_index": map_layer.z_index,
                "visible": map_layer.visible,
            }
            local_file = _local_layer_file(layer.data_link)
            if local_file:
                package_path = f"data/{layer.id}/{local_file.name}"
                archive.write(local_file, package_path)
                layer_data["package_path"] = package_path
            manifest["layers"].append(layer_data)

        archive.writestr(
            "project.json",
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        )

    package.seek(0)
    headers = {
        "Content-Disposition": "attachment; filename=geopilot-project.geopilot",
    }
    return StreamingResponse(package, media_type="application/zip", headers=headers)


@router.patch("/{map_id}", response_model=MapRead)
async def update_map(
    map_id: UUID,
    payload: MapUpdate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MapRead:
    """Update a map."""
    map_obj = await _get_map_for_user(map_id, db, current_user)

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    for key, value in updates.items():
        setattr(map_obj, key, value)

    await db.commit()
    await db.refresh(map_obj)
    return MapRead.model_validate(map_obj)


@router.delete("/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_map(
    map_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a map."""
    map_obj = await _get_map_for_user(map_id, db, current_user)

    await db.delete(map_obj)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{map_id}/layers", response_model=list[MapLayerRead])
async def list_map_layers(
    map_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[MapLayerRead]:
    """List layers for a map."""
    await _get_map_for_user(map_id, db, current_user)

    result = await db.execute(
        select(MapLayer, Layer)
        .join(Layer, MapLayer.layer_id == Layer.id)
        .where(MapLayer.map_id == map_id, Layer.owner_id == current_user.id)
        .order_by(MapLayer.z_index.asc())
    )

    records: list[MapLayerRead] = []
    for map_layer, layer in result.all():
        base = LayerRead.model_validate(layer).model_dump()
        records.append(
            MapLayerRead.model_validate(
                {
                    **base,
                    "z_index": map_layer.z_index,
                    "visible": map_layer.visible,
                }
            )
        )

    return records


@router.put("/{map_id}/layers")
async def replace_map_layers(
    map_id: UUID,
    payload: list[MapLayerItem],
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Replace map layer composition."""
    await _get_map_for_user(map_id, db, current_user)

    layer_ids = {item.layer_id for item in payload}
    if layer_ids:
        result = await db.execute(
            select(Layer.id).where(Layer.id.in_(layer_ids), Layer.owner_id == current_user.id)
        )
        existing_ids = {row[0] for row in result.all()}
        missing = layer_ids - existing_ids
        if missing:
            raise HTTPException(status_code=404, detail="Layer not found")

    await db.execute(delete(MapLayer).where(MapLayer.map_id == map_id))
    for item in payload:
        db.add(
            MapLayer(
                map_id=map_id,
                layer_id=item.layer_id,
                z_index=item.z_index,
                visible=item.visible,
            )
        )

    await db.commit()
    return {"saved": len(payload)}
