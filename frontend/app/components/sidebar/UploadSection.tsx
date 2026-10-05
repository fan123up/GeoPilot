"use client";

import { useRef, useState, useEffect } from "react";
import { formatFileSize, isFileSizeValid } from "../../utils/fileUtils";
import { getUploadUrl, getApiBase } from "../../utils/apiBase";
import { sha256OfFile } from "../../utils/hashUtil";
import Logger from "../../utils/logger";

const UPLOAD_MESSAGES = [
  "正在读取空间元数据…",
  "正在校验坐标与几何信息…",
  "正在为当前地图准备图层…",
];

const FINALIZING_MESSAGES = [
  "正在登记新图层…",
  "正在完成地图成果…",
];

function getRandomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([".geojson", ".zip", ".tif", ".tiff"]);

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

interface UploadSectionProps {
  addLayer: (layer: any) => void;
}

export default function UploadSection({ addLayer }: UploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [funnyMessage, setFunnyMessage] = useState<string>("");

  const MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB in bytes
  const MAX_FILE_SIZE_FORMATTED = formatFileSize(MAX_FILE_SIZE);

  // Rotate funny messages during upload for entertainment
  useEffect(() => {
    if (!isUploading) return;

    const messageRotationInterval = setInterval(() => {
      if (uploadProgress < 70) {
        setFunnyMessage(getRandomMessage(UPLOAD_MESSAGES));
      } else {
        setFunnyMessage(getRandomMessage(FINALIZING_MESSAGES));
      }
    }, 3000); // Change message every 3 seconds

    return () => clearInterval(messageRotationInterval);
  }, [isUploading, uploadProgress]);

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentFileIndex(0);
      setTotalFiles(0);
      setCurrentFileName("");
      setFunnyMessage("");
      setUploadError("上传已取消");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const unsupportedFile = files.find(
      (file) => !SUPPORTED_UPLOAD_EXTENSIONS.has(getFileExtension(file.name)),
    );
    if (unsupportedFile) {
      setUploadError(
        `不支持的格式：${unsupportedFile.name}。请选择 GeoJSON、Shapefile ZIP 或 TIFF 文件。`,
      );
      e.target.value = "";
      return;
    }

    // Clear any previous error message
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);
    setTotalFiles(files.length);
    setCurrentFileIndex(0);

    const API_UPLOAD_URL = getUploadUrl();
    const API_BASE_URL = getApiBase();
    const newLayers: any[] = [];

    try {
      // Process each supported upload sequentially.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrentFileIndex(i + 1);
        setCurrentFileName(file.name);

        // Set a funny upload message
        setFunnyMessage(getRandomMessage(UPLOAD_MESSAGES));

        // Check file size limit
        if (!isFileSizeValid(file, MAX_FILE_SIZE)) {
          throw new Error(
            `文件 ${file.name} 大小为 ${formatFileSize(file.size)}，超过 ${MAX_FILE_SIZE_FORMATTED} 限制。`,
          );
        }

        // Upload phase (0-70% of total progress for this file)
        const baseProgress = (i / files.length) * 100;
        const uploadPhaseProgress = (progressPercent: number) => {
          const fileProgress = baseProgress + (progressPercent * 0.7) / files.length;
          setUploadProgress(Math.round(fileProgress));
        };

        // assemble form data
        const formData = new FormData();
        formData.append("file", file);

        // Upload the file
        // Compute SHA-256 locally before upload for integrity verification
        const localSha256 = await sha256OfFile(file);

        const uploadResult = await new Promise<{
          url: string;
          id: string;
          name?: string;
          converted?: boolean;
          data_type?: string;
          layer_type?: string;
          bounding_box?: number[] | string | null;
          properties?: Record<string, any>;
        }>(
          (resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhrRef.current = xhr;

            xhr.open("POST", API_UPLOAD_URL);

            // Set up progress tracking for upload phase
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percentComplete = Math.round(
                  (event.loaded / event.total) * 100,
                );
                uploadPhaseProgress(percentComplete);
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const data = JSON.parse(xhr.responseText);
                  resolve(data);
                } catch (error) {
                  reject(new Error("服务器返回了无效的 JSON 数据"));
                }
              } else {
                try {
                  const errorData = JSON.parse(xhr.responseText);
                  reject(new Error(errorData.detail || "上传失败"));
                } catch (e) {
                  reject(new Error(`上传失败：${xhr.statusText}`));
                }
              }
            };

            xhr.onerror = () => reject(new Error("发生网络错误"));
            xhr.ontimeout = () => reject(new Error("上传超时"));
            xhr.onabort = () => reject(new Error("上传已取消"));

            xhr.send(formData);
          },
        );
        const { url, id, name: convertedName, converted = false } = uploadResult;

        // Upload completed, update progress to 70%
        const uploadCompleteProgress = baseProgress + 70 / files.length;
        setUploadProgress(Math.round(uploadCompleteProgress));

        // Verify integrity against backend-reported hash/size
        try {
          const metaRes = await fetch(
            `${API_BASE_URL}/uploads/meta/${encodeURIComponent(id)}`,
          );
          if (metaRes.ok) {
            const meta = await metaRes.json();
            if (!converted && meta?.sha256 && typeof meta.sha256 === "string") {
              if (meta.sha256.toLowerCase() !== localSha256.toLowerCase()) {
                throw new Error(
                  `${file.name} 完整性校验失败。预期 ${localSha256.slice(0, 8)}…，实际 ${String(meta.sha256).slice(0, 8)}…`,
                );
              }
            }
            if (!converted && meta?.size && Number.isFinite(Number(meta.size))) {
              const serverSize = Number(meta.size);
              if (serverSize !== file.size) {
                throw new Error(
                  `${file.name} 文件大小不一致。本地为 ${file.size} 字节，服务器为 ${serverSize} 字节。`,
                );
              }
            }
          } else {
            Logger.warn(
              "Upload meta endpoint returned",
              metaRes.status,
              metaRes.statusText,
            );
          }
        } catch (verifyErr) {
          // Surface integrity failure to the user and abort processing this file
          throw verifyErr instanceof Error
            ? verifyErr
            : new Error(String(verifyErr));
        }

        // Create the new layer
        const newLayer = {
          id: id,
          name: convertedName || file.name,
          data_type: uploadResult.data_type || "uploaded",
          data_link: url,
          visible: true,
          data_source_id: "manual",
          data_origin: "uploaded",
          data_source: "user",
          layer_type: uploadResult.layer_type || "UPLOADED",
          bounding_box: uploadResult.bounding_box || undefined,
          properties: uploadResult.properties || {},
        };

        // Add to store
        addLayer(newLayer);
        newLayers.push(newLayer);

        setUploadProgress(Math.round(baseProgress + 100 / files.length));
        setFunnyMessage(getRandomMessage(FINALIZING_MESSAGES));
      }

      // All files processed successfully
      setUploadProgress(100);
      Logger.log(`Successfully uploaded ${files.length} file(s)`);
    } catch (err) {
      if (err instanceof Error && err.message === "上传已取消") {
        Logger.log("Upload was cancelled by the user");
      } else {
        setUploadError(
          `上传错误：${err instanceof Error ? err.message : String(err)}`,
        );
        Logger.error("Error uploading files:", err);
      }
    } finally {
      // reset so same files can be re‑picked
      e.target.value = "";
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentFileIndex(0);
      setTotalFiles(0);
      setCurrentFileName("");
      setFunnyMessage("");
      xhrRef.current = null;
    }
  };

  return (
    <div className="mb-4">
      <h3 className="font-semibold mb-2">上传数据</h3>
      <div
        className={`border border-dashed border-primary-400 p-4 rounded bg-primary-100 text-center cursor-pointer ${isUploading ? "opacity-75" : ""}`}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".geojson,.zip,.tif,.tiff"
          onChange={handleFileUpload}
          className="hidden"
          disabled={isUploading}
          multiple
        />
        {isUploading ? (
          <div className="flex flex-col items-center justify-center">
            <div className="w-full max-w-xs bg-primary-200 rounded-full h-2.5 mb-2">
              <div
                className="bg-info-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-info-600">已完成 {uploadProgress}%</p>
            {totalFiles > 1 && (
              <p className="text-xs text-neutral-600">
                第 {currentFileIndex} 个，共 {totalFiles} 个文件
              </p>
            )}
            {currentFileName && (
              <p className="text-xs text-neutral-700 dark:text-neutral-300 mt-1 truncate max-w-xs">
                {currentFileName}
              </p>
            )}
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 text-center italic">
              {funnyMessage ||
                (uploadProgress < 70
                  ? "正在上传…"
                  : uploadProgress < 100
                    ? "正在登记图层…"
                    : "正在完成…")}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation(); // Prevent triggering the file input click
                cancelUpload();
              }}
              className="mt-2 px-3 py-1 bg-danger-100 text-danger-700 text-xs rounded hover:bg-danger-200 transition-colors"
            >
              取消上传
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              选择 GeoJSON、Shapefile ZIP 或 TIFF 文件
            </p>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
              支持多文件上传 · 单个文件最大 {MAX_FILE_SIZE_FORMATTED}
            </p>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              支持格式：.geojson、.zip、.tif、.tiff
            </p>
          </>
        )}
      </div>
      {uploadError && (
        <div className="mt-2 p-2 bg-danger-100 border border-danger-400 text-danger-700 text-sm rounded">
          {uploadError}
        </div>
      )}
    </div>
  );
}
