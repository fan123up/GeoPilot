import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import unquote, urlparse

from core.config import BASE_URL, LOCAL_UPLOAD_DIR
from utility.string_methods import sanitize_filename


class RasterProcessingError(Exception):
    """Raised when GDAL raster processing fails."""


def _run_gdal(args: List[str], timeout: int = 300) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RasterProcessingError(
            "GDAL command not found. Please rebuild the backend Docker image with gdal-bin."
        ) from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise RasterProcessingError(message) from exc
    except subprocess.TimeoutExpired as exc:
        raise RasterProcessingError("GDAL operation timed out.") from exc


def _iter_coordinate_pairs(value: Any) -> Iterable[List[float]]:
    if not isinstance(value, list):
        return
    if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        yield [float(value[0]), float(value[1])]
        return
    for item in value:
        yield from _iter_coordinate_pairs(item)


def _bounds_from_pairs(pairs: Iterable[List[float]]) -> Optional[List[float]]:
    coords = list(pairs)
    if not coords:
        return None
    xs = [pair[0] for pair in coords]
    ys = [pair[1] for pair in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def _bounds_are_lonlat(bounds: List[float]) -> bool:
    return (
        -180 <= bounds[0] <= 180
        and -90 <= bounds[1] <= 90
        and -180 <= bounds[2] <= 180
        and -90 <= bounds[3] <= 90
    )


def bounds_to_wkt(bounds: List[float]) -> str:
    minx, miny, maxx, maxy = bounds
    return (
        "POLYGON(("
        f"{minx} {miny}, {maxx} {miny}, {maxx} {maxy}, "
        f"{minx} {maxy}, {minx} {miny}"
        "))"
    )


def _upload_url(filename: str) -> str:
    return f"{BASE_URL}/api/stream/{filename}"


def resolve_local_upload_path(link_or_name: str) -> Path:
    """Resolve a layer URL or uploaded filename to a safe local upload path."""
    if not link_or_name:
        raise RasterProcessingError("Missing raster path.")

    candidate = link_or_name
    if candidate.startswith("http://") or candidate.startswith("https://"):
        parsed = urlparse(candidate)
        candidate = unquote(Path(parsed.path).name)
    elif candidate.startswith("/"):
        candidate = unquote(Path(candidate).name)

    safe_name = sanitize_filename(Path(candidate).name)
    if not safe_name:
        raise RasterProcessingError("Invalid uploaded filename.")

    upload_root = Path(LOCAL_UPLOAD_DIR).resolve()
    path = (upload_root / safe_name).resolve()
    try:
        path.relative_to(upload_root)
    except ValueError as exc:
        raise RasterProcessingError("Invalid uploaded path.") from exc

    if not path.exists() or not path.is_file():
        raise RasterProcessingError(f"Uploaded file not found: {safe_name}")
    return path


def get_raster_bounds(path: Path) -> Optional[List[float]]:
    result = _run_gdal(["gdalinfo", "-json", str(path)])
    info = json.loads(result.stdout)

    wgs84_extent = info.get("wgs84Extent") or {}
    bounds = _bounds_from_pairs(_iter_coordinate_pairs(wgs84_extent.get("coordinates")))
    if bounds and _bounds_are_lonlat(bounds):
        return bounds

    corners = info.get("cornerCoordinates") or {}
    corner_pairs = [
        corners.get("upperLeft"),
        corners.get("upperRight"),
        corners.get("lowerRight"),
        corners.get("lowerLeft"),
    ]
    bounds = _bounds_from_pairs(pair for pair in corner_pairs if isinstance(pair, list))
    if bounds and _bounds_are_lonlat(bounds):
        return bounds
    return None


def create_raster_preview(path: Path, max_width: int = 1200) -> Dict[str, Any]:
    """Create a browser-displayable PNG preview for a GeoTIFF."""
    upload_root = Path(LOCAL_UPLOAD_DIR)
    preview_name = sanitize_filename(f"{path.stem}_preview_{uuid.uuid4().hex[:8]}.png")
    preview_path = upload_root / preview_name

    _run_gdal(
        [
            "gdal_translate",
            "-of",
            "PNG",
            "-ot",
            "Byte",
            "-scale",
            "-outsize",
            str(max_width),
            "0",
            str(path),
            str(preview_path),
        ]
    )

    bounds = get_raster_bounds(path)
    return {
        "preview_name": preview_name,
        "preview_url": _upload_url(preview_name),
        "bounds": bounds,
        "bounding_box": bounds_to_wkt(bounds) if bounds else None,
    }


def make_output_raster_name(source_name: str, operation: str) -> str:
    stem = re.sub(r"\.(tif|tiff)$", "", Path(source_name).name, flags=re.IGNORECASE)
    safe_stem = sanitize_filename(stem) or "raster"
    return f"{uuid.uuid4().hex}_{safe_stem}_{operation}.tif"


def reproject_raster(source: Path, target_crs: str, output_name: str) -> Path:
    output = Path(LOCAL_UPLOAD_DIR) / output_name
    _run_gdal(
        [
            "gdalwarp",
            "-t_srs",
            target_crs,
            "-of",
            "GTiff",
            "-co",
            "TILED=YES",
            "-co",
            "COMPRESS=LZW",
            str(source),
            str(output),
        ],
        timeout=600,
    )
    return output


def clip_raster_by_vector(source: Path, vector: Path, output_name: str) -> Path:
    output = Path(LOCAL_UPLOAD_DIR) / output_name
    _run_gdal(
        [
            "gdalwarp",
            "-cutline",
            str(vector),
            "-crop_to_cutline",
            "-of",
            "GTiff",
            "-co",
            "TILED=YES",
            "-co",
            "COMPRESS=LZW",
            str(source),
            str(output),
        ],
        timeout=600,
    )
    return output


def merge_rasters(sources: List[Path], output_name: str) -> Path:
    if len(sources) < 2:
        raise RasterProcessingError("Mosaic/merge requires at least two raster layers.")

    upload_root = Path(LOCAL_UPLOAD_DIR)
    vrt_path = upload_root / f"{uuid.uuid4().hex}_mosaic.vrt"
    output = upload_root / output_name
    try:
        _run_gdal(["gdalbuildvrt", str(vrt_path), *[str(path) for path in sources]], timeout=600)
        _run_gdal(
            [
                "gdal_translate",
                "-of",
                "GTiff",
                "-co",
                "TILED=YES",
                "-co",
                "COMPRESS=LZW",
                str(vrt_path),
                str(output),
            ],
            timeout=600,
        )
    finally:
        try:
            if vrt_path.exists():
                os.remove(vrt_path)
        except OSError:
            pass
    return output
