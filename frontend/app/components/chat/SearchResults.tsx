"use client";

import { useState } from "react";
import { MapPin, Square, Minus } from "lucide-react";
import { GeoDataObject } from "../../models/geodatamodel";

interface SearchResultsProps {
  results: GeoDataObject[];
  loading: boolean;
  onSelectLayer: (result: GeoDataObject) => void;
}

// --- Overpass grouping ---

interface OverpassProps {
  featureCount: number;
  queryAmenityKey: string;
  queryLocation: string;
  queryOsmTag: string;
  geometryType: string;
  geometryLabel: string;
  geometryHint: string;
  sampleNames: string[];
  spatialExtent: string | null;
}

function isOverpassCollection(result: GeoDataObject): boolean {
  return result.data_source_id === "geocodeOverpassCollection";
}

function getOverpassProps(result: GeoDataObject): OverpassProps {
  const props = result.properties as Record<string, unknown> | undefined;
  return {
    featureCount: (props?.feature_count as number) || 0,
    queryAmenityKey: (props?.query_amenity_key as string) || "",
    queryLocation: (props?.query_location as string) || "",
    queryOsmTag: (props?.query_osm_tag as string) || "",
    geometryType: (props?.geometry_type_collected as string) || "",
    geometryLabel: (props?.geometry_label as string) || "",
    geometryHint: (props?.geometry_hint as string) || "",
    sampleNames: Array.isArray(props?.sample_names)
      ? (props.sample_names as string[])
      : [],
    spatialExtent: (props?.spatial_extent as string) || null,
  };
}

interface OverpassGroup {
  groupKey: string;
  groupTitle: string;
  spatialExtent: string | null;
  results: GeoDataObject[];
}

function groupOverpassResults(results: GeoDataObject[]): {
  groups: OverpassGroup[];
  others: GeoDataObject[];
} {
  const groups: OverpassGroup[] = [];
  const others: GeoDataObject[] = [];
  const groupMap = new Map<string, OverpassGroup>();

  for (const result of results) {
    if (!isOverpassCollection(result)) {
      others.push(result);
      continue;
    }
    const p = getOverpassProps(result);
    const key = `${p.queryOsmTag}__${p.queryLocation}`;
    if (!groupMap.has(key)) {
      const group: OverpassGroup = {
        groupKey: key,
        groupTitle: p.queryAmenityKey
          ? `${p.queryLocation} · ${p.queryAmenityKey}`
          : p.queryLocation,
        spatialExtent: p.spatialExtent,
        results: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    groupMap.get(key)!.results.push(result);
  }

  return { groups, others };
}

function GeometryTypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t === "points") return <MapPin size={11} className="flex-shrink-0 mt-px" />;
  if (t === "areas") return <Square size={11} className="flex-shrink-0 mt-px" />;
  if (t === "lines") return <Minus size={11} className="flex-shrink-0 mt-px" />;
  return null;
}

// Shared details popup used by both card types
function DetailsPopup({
  result,
  onClose,
}: {
  result: GeoDataObject;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed left-4 right-4 bottom-20 max-h-[60vh] overflow-y-auto bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-xl p-4 z-50 md:absolute md:bottom-full md:left-0 md:right-auto md:mb-2 md:w-80 md:max-h-96"
      onClick={(e) => e.stopPropagation()}
    >
      <h4 className="font-bold text-sm mb-2 break-words">
        {result.title || "详细信息"}
      </h4>
      <p className="text-xs mb-2 break-words">
        <strong>描述：</strong>{" "}
        {result.llm_description || result.description || "暂无"}
      </p>
      <p className="text-xs mb-2 break-words">
        <strong>数据来源：</strong> {result.data_source || "暂无"}
      </p>
      <p className="text-xs mb-2">
        <strong>图层类型：</strong> {result.layer_type || "暂无"}
      </p>
      {result.bounding_box && (
        <p className="text-xs break-all">
          <strong>空间范围：</strong>{" "}
          {typeof result.bounding_box === "string"
            ? result.bounding_box
            : JSON.stringify(result.bounding_box)}
        </p>
      )}

      {result.processing_metadata && (
        <div className="pt-3 mt-3 border-t border-neutral-200">
          <h5 className="font-semibold text-neutral-700 mb-2 text-xs">
            处理信息
          </h5>
          <div className="space-y-1">
            {result.processing_metadata.origin_layers &&
              result.processing_metadata.origin_layers.length > 0 && (
                <p className="text-xs text-neutral-900 dark:text-neutral-100">
                  <strong className="text-neutral-700 dark:text-neutral-200">
                    来源图层：
                  </strong>{" "}
                  {result.processing_metadata.origin_layers.join(", ")}
                </p>
              )}
            <p className="text-xs text-neutral-900 dark:text-neutral-100 capitalize">
              <strong className="text-neutral-700 dark:text-neutral-200">
                操作：
              </strong>{" "}
              {result.processing_metadata.operation}
            </p>
            <p className="text-xs text-neutral-900 dark:text-neutral-100">
              <strong className="text-neutral-700 dark:text-neutral-200">
                使用的坐标参考系：
              </strong>{" "}
              {result.processing_metadata.crs_used}
              {result.processing_metadata.auto_selected && " 🎯"}
              {result.processing_metadata.authority === "WKT" &&
                result.processing_metadata.wkt && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(
                          `自定义坐标参考系（WKT）：\n\n${result.processing_metadata!.wkt!}`
                        );
                      }}
                      aria-label="查看自定义坐标参考系 WKT"
                    >
                      （详情）
                    </button>
                  </>
                )}
            </p>
            <p className="text-xs text-neutral-900 dark:text-neutral-100">
              <strong className="text-neutral-700 dark:text-neutral-200">
                坐标参考系名称：
              </strong>{" "}
              {result.processing_metadata.crs_name}
            </p>
            {result.processing_metadata.projection_property && (
              <p className="text-xs text-neutral-900 dark:text-neutral-100 capitalize">
                <strong className="text-neutral-700 dark:text-neutral-200">
                  投影属性：
                </strong>{" "}
                {result.processing_metadata.projection_property}
              </p>
            )}
            {result.processing_metadata.selection_reason && (
              <p className="text-xs text-neutral-900 dark:text-neutral-100">
                <strong className="text-neutral-700 dark:text-neutral-200">
                  选择原因：
                </strong>{" "}
                {result.processing_metadata.selection_reason}
              </p>
            )}
            {result.processing_metadata.expected_error !== undefined && (
              <p className="text-xs text-neutral-900 dark:text-neutral-100">
                <strong className="text-neutral-700 dark:text-neutral-200">
                  预期误差：
                </strong>{" "}
                &lt;{result.processing_metadata.expected_error}%
              </p>
            )}
          </div>
        </div>
      )}

      {/* Query Construction Section (for geocoding results) */}
      {result.processing_metadata?.query_intent && (
        <div className="pt-3 mt-3 border-t border-neutral-200 dark:border-neutral-600">
          <h5 className="font-semibold text-neutral-700 dark:text-neutral-200 mb-2 text-xs">
            查询构建信息
          </h5>

          {/* Search intent */}
          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">
              搜索意图
            </span>
            <p className="text-xs text-neutral-900 dark:text-neutral-100 mt-1">
              &quot;{result.processing_metadata.query_intent}&quot;
              {result.processing_metadata.query_location && (
                <>，位置：{result.processing_metadata.query_location}</>
              )}
            </p>
          </div>

          {/* Resolution method */}
          {result.processing_metadata.resolution_detail && (
            <div className="mb-2">
              <span className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs">
                解析方式：
              </span>
              <p className="text-xs text-neutral-900 dark:text-neutral-100">
                {result.processing_metadata.resolution_detail}
              </p>
            </div>
          )}

          {/* Tags used */}
          {result.processing_metadata.osm_tags_used &&
            result.processing_metadata.osm_tags_used.length > 0 && (
              <div className="mb-2">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs">
                  OSM 标签（{result.processing_metadata.osm_tags_used.length}）：
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.processing_metadata.osm_tags_used.map((tag: string) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded text-xs font-mono"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {/* Excluded tags (if any) */}
          {result.processing_metadata.osm_tags_excluded &&
            result.processing_metadata.osm_tags_excluded.length > 0 && (
              <div className="mb-2">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs">
                  已排除：
                </span>
                {result.processing_metadata.osm_tags_excluded.map(
                  (e: { tag: string; reason: string }) => (
                    <p key={e.tag} className="text-xs text-neutral-600 dark:text-neutral-400 italic">
                      {e.tag} — {e.reason}
                    </p>
                  )
                )}
              </div>
            )}

          {/* Refinement hint */}
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-2 italic">
            可在对话中继续细化该查询
          </p>
        </div>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="mt-3 w-full py-2 bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 rounded text-xs font-medium md:hidden"
      >
        关闭
      </button>
    </div>
  );
}

// Card for a single geometry type within an Overpass group
function GeometryCard({
  result,
  onSelectLayer,
  activeDetailsId,
  setActiveDetailsId,
}: {
  result: GeoDataObject;
  onSelectLayer: (r: GeoDataObject) => void;
  activeDetailsId: string | null;
  setActiveDetailsId: (id: string | null) => void;
}) {
  const p = getOverpassProps(result);

  return (
    <div className="border rounded p-2 bg-white dark:bg-neutral-800 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
      {/* Header: geometry label + feature count */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex items-center gap-1 font-semibold text-xs text-neutral-800 dark:text-neutral-100 min-w-0">
          <GeometryTypeIcon type={p.geometryType} />
          <span className="break-words">{p.geometryLabel || p.geometryType}</span>
        </div>
        <span className="text-[10px] text-neutral-700 dark:text-neutral-300 flex-shrink-0 bg-neutral-200 dark:bg-neutral-700 rounded px-1 whitespace-nowrap">
          {p.featureCount.toLocaleString()} 个要素
        </span>
      </div>

      {/* Hint */}
      {p.geometryHint && (
        <div className="text-[10px] text-neutral-600 dark:text-neutral-400 mb-1 italic">
          {p.geometryHint}
        </div>
      )}

      {/* Sample names preview */}
      {p.sampleNames.length > 0 && (
        <div className="text-[10px] text-neutral-700 dark:text-neutral-300 mb-2 line-clamp-1">
          例如：{p.sampleNames.slice(0, 3).join(", ")}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1.5 relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelectLayer(result);
          }}
          className="px-2 py-1 bg-info-600 text-neutral-50 rounded text-xs hover:bg-info-700 flex-shrink-0"
        >
          添加到地图
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setActiveDetailsId(
              activeDetailsId === result.id ? null : result.id
            );
          }}
          className="px-2 py-1 bg-neutral-200 text-neutral-700 rounded text-xs hover:bg-neutral-300 flex-shrink-0"
        >
          详情
        </button>

        {activeDetailsId === result.id && (
          <DetailsPopup
            result={result}
            onClose={() => setActiveDetailsId(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function SearchResults({
  results,
  loading,
  onSelectLayer,
}: SearchResultsProps) {
  const [showAllResults, setShowAllResults] = useState(false);
  const [activeDetailsId, setActiveDetailsId] = useState<string | null>(null);

  if (results.length === 0) {
    return null;
  }

  const { groups, others } = groupOverpassResults(results);
  const othersToShow = showAllResults ? others : others.slice(0, 5);

  return (
    <div className="mt-6 mb-2 px-2 bg-neutral-50 dark:bg-neutral-900 rounded border dark:border-neutral-700">
      <div className="font-semibold p-1">搜索结果</div>

      {/* Overpass geometry groups */}
      {groups.map((group) => (
        <div key={group.groupKey} className="border-b dark:border-neutral-700 last:border-none py-2">
          {/* Group header */}
          <div className="mb-2">
            <div className="font-semibold text-sm text-neutral-800 dark:text-neutral-100">
              {group.groupTitle}
            </div>
            {group.spatialExtent && (
              <div className="text-[10px] text-neutral-600 dark:text-neutral-400">
                {group.spatialExtent}
              </div>
            )}
            {group.results.length > 1 && (
              <div className="text-[10px] text-neutral-600 dark:text-neutral-400 mt-0.5">
                选择一个或多个要添加的几何类型：
              </div>
            )}
          </div>

          {/* One card per geometry type */}
          <div className="flex flex-col gap-2">
            {group.results.map((result) => (
              <GeometryCard
                key={result.id}
                result={result}
                onSelectLayer={onSelectLayer}
                activeDetailsId={activeDetailsId}
                setActiveDetailsId={setActiveDetailsId}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Non-Overpass results (uploads, Nominatim, processing outputs, etc.) */}
      {othersToShow.map((result) => {
        return (
          <div
            key={result.id}
            className="p-2 border-b dark:border-neutral-700 last:border-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <div
              onClick={() => onSelectLayer(result)}
              className="cursor-pointer"
            >
              <div className="font-bold text-sm break-words">{result.title}</div>
              <div
                className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-2"
                title={result.llm_description}
              >
                {result.llm_description}
              </div>

              {/* Buttons row */}
              <div className="flex flex-wrap items-center gap-2 mt-2 relative">
                <button
                  className="px-2 py-1 text-xs rounded bg-primary-200 text-primary-900 hover:bg-primary-300 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDetailsId(null);
                  }}
                >
                  类型：{result.layer_type && `${result.layer_type}`}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDetailsId(
                      activeDetailsId === result.id ? null : result.id
                    );
                  }}
                  className="px-2 py-1 bg-neutral-300 text-neutral-900 rounded text-xs hover:bg-neutral-400 flex-shrink-0"
                >
                  详情
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLayer(result);
                  }}
                  className="px-2 py-1 bg-info-600 text-neutral-50 rounded text-xs hover:bg-info-700 flex-shrink-0"
                >
                  添加到地图
                </button>

                {activeDetailsId === result.id && (
                  <DetailsPopup
                    result={result}
                    onClose={() => setActiveDetailsId(null)}
                  />
                )}
              </div>

              <div className="text-[10px] text-neutral-600 dark:text-neutral-400 mt-1">
                {result.data_origin}
              </div>
            </div>
          </div>
        );
      })}

      {others.length > 5 && (
        <button
          onClick={() => setShowAllResults((s) => !s)}
          className="w-full py-2 text-center text-blue-600 hover:underline"
        >
          {showAllResults
            ? "收起"
            : `查看更多（还有 ${others.length - 5} 项）`}
        </button>
      )}
    </div>
  );
}
