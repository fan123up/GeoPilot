"""Safe conversion helpers for uploaded geospatial files."""

import shutil
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Dict

import geopandas as gpd

from utility.string_methods import sanitize_filename

SHAPEFILE_REQUIRED_EXTENSIONS = {".shp", ".shx", ".dbf"}
SHAPEFILE_OPTIONAL_EXTENSIONS = {".prj", ".cpg"}
SHAPEFILE_EXTENSIONS = SHAPEFILE_REQUIRED_EXTENSIONS | SHAPEFILE_OPTIONAL_EXTENSIONS
MAX_ARCHIVE_MEMBERS = 100


class GeodataConversionError(ValueError):
    """Raised when a geospatial file cannot be safely converted."""


@dataclass(frozen=True)
class GeoJSONConversionResult:
    output_path: Path
    output_name: str


def _copy_stream_limited(stream: BinaryIO, destination: Path, limit: int) -> None:
    total = 0
    with destination.open("wb") as output:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                limit_mb = int(limit / 1024 / 1024)
                raise GeodataConversionError(f"File exceeds the {limit_mb}MB upload limit.")
            output.write(chunk)


def _safe_archive_path(name: str) -> PurePosixPath:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or path.is_absolute()
        or ".." in path.parts
        or any(":" in part for part in path.parts)
    ):
        raise GeodataConversionError(f"Unsafe path in Shapefile archive: {name}")
    return path


def _validate_archive_member(info: zipfile.ZipInfo) -> PurePosixPath:
    path = _safe_archive_path(info.filename)
    if info.flag_bits & 0x1:
        raise GeodataConversionError("Encrypted ZIP archives are not supported.")

    unix_mode = info.external_attr >> 16
    if unix_mode and stat.S_ISLNK(unix_mode):
        raise GeodataConversionError("Symbolic links are not allowed in Shapefile archives.")
    return path


def shapefile_zip_to_geojson(
    stream: BinaryIO,
    output_directory: Path,
    max_input_size: int,
) -> GeoJSONConversionResult:
    """Convert one Shapefile ZIP upload to WGS84 GeoJSON."""

    output_directory.mkdir(parents=True, exist_ok=True)
    archive_path = output_directory / "shapefile-upload.zip"
    _copy_stream_limited(stream, archive_path, max_input_size)

    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = [info for info in archive.infolist() if not info.is_dir()]
            if not members:
                raise GeodataConversionError("The Shapefile ZIP archive is empty.")
            if len(members) > MAX_ARCHIVE_MEMBERS:
                raise GeodataConversionError("The Shapefile ZIP contains too many files.")
            if sum(info.file_size for info in members) > max_input_size * 5:
                raise GeodataConversionError("Expanded Shapefile archive is too large.")

            validated = [(info, _validate_archive_member(info)) for info in members]
            shp_members = [
                (info, path) for info, path in validated if path.suffix.lower() == ".shp"
            ]
            if len(shp_members) != 1:
                raise GeodataConversionError(
                    "A Shapefile ZIP must contain exactly one .shp dataset."
                )

            _shp_info, shp_path = shp_members[0]
            dataset_parent = shp_path.parent
            dataset_stem = shp_path.stem.casefold()
            components: Dict[str, zipfile.ZipInfo] = {}
            for info, path in validated:
                extension = path.suffix.lower()
                if (
                    path.parent == dataset_parent
                    and path.stem.casefold() == dataset_stem
                    and extension in SHAPEFILE_EXTENSIONS
                ):
                    if extension in components:
                        raise GeodataConversionError(
                            f"Duplicate {extension} component in Shapefile ZIP."
                        )
                    components[extension] = info

            missing = SHAPEFILE_REQUIRED_EXTENSIONS - components.keys()
            if missing:
                raise GeodataConversionError(
                    "Shapefile ZIP is missing required components: " + ", ".join(sorted(missing))
                )

            safe_stem = Path(sanitize_filename(shp_path.stem)).stem or "layer"
            for extension, info in components.items():
                destination = output_directory / f"{safe_stem}{extension}"
                with archive.open(info) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)

        shapefile_path = output_directory / f"{safe_stem}.shp"
        gdf = gpd.read_file(shapefile_path)
        if gdf.crs is not None:
            gdf = gdf.to_crs("EPSG:4326")
        else:
            gdf = gdf.set_crs("EPSG:4326", allow_override=True)

        output_name = f"{safe_stem}.geojson"
        output_path = output_directory / output_name
        gdf.to_file(output_path, driver="GeoJSON", index=False)
        return GeoJSONConversionResult(output_path=output_path, output_name=output_name)
    except zipfile.BadZipFile as exc:
        raise GeodataConversionError("Uploaded ZIP is not a valid archive.") from exc
    except Exception as exc:
        if isinstance(exc, GeodataConversionError):
            raise
        raise GeodataConversionError(f"Unable to convert Shapefile ZIP to GeoJSON: {exc}") from exc
    finally:
        archive_path.unlink(missing_ok=True)
