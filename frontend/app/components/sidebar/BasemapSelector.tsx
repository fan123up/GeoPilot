"use client";

interface BasemapSelectorProps {
  onBasemapChange: (basemapKey: string) => void;
  selectedKey: string;
}

export default function BasemapSelector({
  onBasemapChange,
  selectedKey,
}: BasemapSelectorProps) {
  const handleBasemapChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onBasemapChange(e.target.value);
  };

  return (
    <div>
      <h3 className="font-semibold mb-2">底图</h3>
      <select
        className="w-full p-2 border rounded"
        onChange={handleBasemapChange}
        value={selectedKey}
        data-testid="basemap-select"
      >
        <option value="none">无底图</option>
        <option value="osm">OpenStreetMap</option>
        <option value="google-terrain">Google Terrain</option>
      </select>
    </div>
  );
}
