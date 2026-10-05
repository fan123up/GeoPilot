import json
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command
from typing_extensions import Annotated

from core.config import BASE_URL
from models.geodata import DataOrigin, DataType, GeoDataObject
from models.states import GeoDataAgentState
from services.raster_processing import (
    RasterProcessingError,
    bounds_to_wkt,
    clip_raster_by_vector,
    create_raster_preview,
    make_output_raster_name,
    merge_rasters,
    reproject_raster,
    resolve_local_upload_path,
)
from services.tools.geoprocessing.utils import get_last_human_content
from services.tools.utils import get_all_available_layers, match_layer_names


def _is_raster_layer(layer: Any) -> bool:
    layer_type = str(getattr(layer, "layer_type", "") or "").upper()
    data_type = str(getattr(layer, "data_type", "") or "").lower()
    link = str(getattr(layer, "data_link", "") or "").lower()
    return layer_type == "RASTER" or data_type == "datatype.raster" or data_type == "raster" or link.endswith((".tif", ".tiff"))


def _is_vector_layer(layer: Any) -> bool:
    return not _is_raster_layer(layer) and str(getattr(layer, "data_link", "") or "").lower().endswith((".geojson", ".json"))


def _infer_operation(query: str, operation: Optional[str]) -> Optional[str]:
    text = f"{operation or ''} {query or ''}".lower()
    if any(word in text for word in ["reproject", "projection", "重投影", "投影转换"]):
        return "reproject"
    if any(word in text for word in ["clip", "crop", "mask", "裁剪", "按范围", "掩膜"]):
        return "clip"
    if any(word in text for word in ["mosaic", "merge", "stitch", "镶嵌", "拼接", "合并"]):
        return "mosaic"
    return operation.lower() if operation else None


def _extract_epsg(query: str, target_crs: Optional[str]) -> Optional[str]:
    if target_crs:
        return target_crs.upper() if target_crs.lower().startswith("epsg:") else target_crs
    match = re.search(r"epsg[:：]?\s*(\d{4,6})", query or "", flags=re.IGNORECASE)
    if match:
        return f"EPSG:{match.group(1)}"
    return None


def _layer_label(layer: Any) -> str:
    return getattr(layer, "title", None) or getattr(layer, "name", None) or getattr(layer, "id", "layer")


def _tool_error(tool_call_id: str, message: str) -> Command:
    return Command(
        update={
            "messages": [
                ToolMessage(
                    name="raster_gdal_tool",
                    content=f"Error: {message}",
                    tool_call_id=tool_call_id,
                    status="error",
                )
            ]
        }
    )


def _make_raster_geodata(
    output_path: Path,
    title: str,
    description: str,
    source_layers: List[str],
) -> GeoDataObject:
    preview = create_raster_preview(output_path)
    bounds = preview.get("bounds")
    out_uuid = uuid.uuid4().hex
    filename = output_path.name

    return GeoDataObject(
        id=out_uuid,
        data_source_id="raster_gdal",
        data_type=DataType.RASTER,
        data_origin=DataOrigin.TOOL,
        data_source="GeoPilotGDAL",
        data_link=f"{BASE_URL}/api/stream/{filename}",
        name=Path(filename).stem,
        title=title,
        description=description,
        llm_description=description,
        score=0.2,
        bounding_box=bounds_to_wkt(bounds) if bounds else None,
        layer_type="RASTER",
        properties={
            "preview_url": preview.get("preview_url"),
            "preview_name": preview.get("preview_name"),
            "raster_bounds": bounds,
            "source_layers": source_layers,
        },
    )


@tool
def raster_gdal_tool(
    state: Annotated[GeoDataAgentState, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
    target_layer_names: Optional[List[str]] = None,
    operation: Optional[str] = None,
    target_crs: Optional[str] = None,
    vector_layer_name: Optional[str] = None,
    add_to_results: bool = True,
) -> Union[Dict[str, Any], Command]:
    """
    Process uploaded raster layers with GDAL.

    Use this when the user asks to process TIFF/GeoTIFF raster layers, including:
    - reproject a raster to a CRS such as EPSG:4326 or EPSG:3857
    - clip/crop a raster by an existing vector/GeoJSON boundary layer
    - mosaic/merge/stitch multiple raster layers into one raster

    Args:
        state: The agent state containing geodata layers.
        tool_call_id: ID for this tool call.
        target_layer_names: Raster layer names to process. Include vector layer names too when clipping.
        operation: One of reproject, clip, mosaic.
        target_crs: Target CRS for reproject, for example EPSG:4326.
        vector_layer_name: Vector boundary layer name used for clip/crop.
        add_to_results: Whether to add output to the final result list.
    """
    layers = get_all_available_layers(state)
    if not layers:
        return _tool_error(tool_call_id, "No layers found. Please upload raster data first.")

    query = get_last_human_content(state.get("messages") or [])
    selected_layers = match_layer_names(layers, target_layer_names) if target_layer_names else layers
    raster_layers = [layer for layer in selected_layers if _is_raster_layer(layer)]

    op = _infer_operation(query, operation)
    if op == "merge":
        op = "mosaic"

    if op not in {"reproject", "clip", "mosaic"}:
        return _tool_error(
            tool_call_id,
            "Please specify a raster operation: reproject, clip, or mosaic.",
        )

    if not raster_layers:
        available = [{"name": layer.name, "title": layer.title} for layer in layers if _is_raster_layer(layer)]
        return _tool_error(
            tool_call_id,
            f"No raster layer matched. Available raster layers: {json.dumps(available)}",
        )

    try:
        new_geodata: List[GeoDataObject] = []

        if op == "reproject":
            crs = _extract_epsg(query, target_crs)
            if not crs:
                return _tool_error(tool_call_id, "Reproject requires a target CRS, for example EPSG:4326.")

            for layer in raster_layers:
                source_path = resolve_local_upload_path(layer.data_link)
                output_name = make_output_raster_name(source_path.name, "reproject")
                output_path = reproject_raster(source_path, crs, output_name)
                title = f"{_layer_label(layer)} reprojected"
                description = f"Reprojected raster layer '{_layer_label(layer)}' to {crs} using GDAL."
                new_geodata.append(
                    _make_raster_geodata(output_path, title, description, [_layer_label(layer)])
                )

        elif op == "clip":
            vector_candidates = [layer for layer in selected_layers if _is_vector_layer(layer)]
            if vector_layer_name:
                vector_candidates = match_layer_names(layers, [vector_layer_name])
            vector_layer = next((layer for layer in vector_candidates if _is_vector_layer(layer)), None)
            if not vector_layer:
                return _tool_error(
                    tool_call_id,
                    "Clip requires one vector/GeoJSON boundary layer. Please specify the boundary layer name.",
                )

            vector_path = resolve_local_upload_path(vector_layer.data_link)
            for layer in raster_layers:
                source_path = resolve_local_upload_path(layer.data_link)
                output_name = make_output_raster_name(source_path.name, "clip")
                output_path = clip_raster_by_vector(source_path, vector_path, output_name)
                title = f"{_layer_label(layer)} clipped"
                description = (
                    f"Clipped raster layer '{_layer_label(layer)}' by vector boundary "
                    f"'{_layer_label(vector_layer)}' using GDAL."
                )
                new_geodata.append(
                    _make_raster_geodata(
                        output_path,
                        title,
                        description,
                        [_layer_label(layer), _layer_label(vector_layer)],
                    )
                )

        elif op == "mosaic":
            if len(raster_layers) < 2:
                return _tool_error(tool_call_id, "Mosaic requires at least two raster layers.")
            source_paths = [resolve_local_upload_path(layer.data_link) for layer in raster_layers]
            output_name = make_output_raster_name("raster_mosaic.tif", "mosaic")
            output_path = merge_rasters(source_paths, output_name)
            names = [_layer_label(layer) for layer in raster_layers]
            title = "Raster mosaic"
            description = f"Mosaicked {len(raster_layers)} raster layers using GDAL."
            new_geodata.append(_make_raster_geodata(output_path, title, description, names))

    except RasterProcessingError as exc:
        return _tool_error(tool_call_id, str(exc))

    ref_data = [
        {"id": item.id, "data_source_id": item.data_source_id, "title": item.title}
        for item in new_geodata
    ]
    message = (
        f"Successfully processed {len(new_geodata)} raster layer(s) with GDAL. "
        f"Operation: {op}. Reference data: {json.dumps(ref_data)}"
    )

    update: Dict[str, Any] = {
        "messages": [
            ToolMessage(
                name="raster_gdal_tool",
                content=message,
                tool_call_id=tool_call_id,
            )
        ],
        "geodata_last_results": new_geodata,
    }
    if add_to_results:
        update["geodata_results"] = new_geodata

    return Command(update=update)
