/**
 * Virtualized Masonry Grid Component
 * 支持虚拟化的响应式瀑布流布局，根据容器宽度自动调整列数
 */

import { useEffect, useRef, useState, useCallback, ReactNode, useMemo } from 'react';

interface VirtualizedMasonryProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemKey: (item: T) => string;
  /** 最小列宽(px)，用于计算响应式列数 */
  minColumnWidth?: number;
  /** 最大列数 */
  maxColumns?: number;
  /** 最小列数 */
  minColumns?: number;
  gap?: number;
  overscan?: number;
  estimatedItemHeight?: number;
}

interface ColumnItem<T> {
  item: T;
  index: number;
  top: number;
  height: number;
}

/**
 * 根据容器宽度和最小列宽计算最佳列数
 */
function calculateColumnCount(
  containerWidth: number,
  minColumnWidth: number,
  gap: number,
  minColumns: number,
  maxColumns: number
): number {
  if (containerWidth === 0) return minColumns;

  // 计算能放下的最大列数
  const maxPossibleColumns = Math.floor((containerWidth + gap) / (minColumnWidth + gap));
  // 限制在 minColumns 和 maxColumns 之间
  return Math.min(maxColumns, Math.max(minColumns, maxPossibleColumns));
}

export default function VirtualizedMasonry<T>({
  items,
  renderItem,
  itemKey,
  minColumnWidth = 180,
  maxColumns = 6,
  minColumns = 2,
  gap = 8,
  overscan = 5,
  estimatedItemHeight = 200,
}: VirtualizedMasonryProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const itemHeightsRef = useRef<Map<string, number>>(new Map());

  // 响应式计算列数
  const columnCount = useMemo(
    () => calculateColumnCount(containerWidth, minColumnWidth, gap, minColumns, maxColumns),
    [containerWidth, minColumnWidth, gap, minColumns, maxColumns]
  );

  // 计算列布局
  const { cols, totalHeight } = useMemo(() => {
    const cols: ColumnItem<T>[][] = Array.from({ length: columnCount }, () => []);
    const colHeights = new Array(columnCount).fill(0);

    items.forEach((item, index) => {
      // 找到最短的列（瀑布流核心算法）
      const minHeight = Math.min(...colHeights);
      const minColIndex = colHeights.indexOf(minHeight);

      const key = itemKey(item);
      const height = itemHeightsRef.current.get(key) || estimatedItemHeight;

      cols[minColIndex].push({
        item,
        index,
        top: minHeight,
        height,
      });

      colHeights[minColIndex] += height + gap;
    });

    return { cols, totalHeight: Math.max(...colHeights, 0) };
  }, [items, columnCount, gap, estimatedItemHeight, itemKey, layoutVersion]);

  // 监听滚动和容器尺寸变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    const handleResize = () => {
      setContainerHeight(container.clientHeight);
      setContainerWidth(container.clientWidth);
    };

    // 使用 ResizeObserver 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    handleResize();
    container.addEventListener('scroll', handleScroll, { passive: true });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  // 更新元素高度
  const handleItemResize = useCallback((key: string, height: number) => {
    const currentHeight = itemHeightsRef.current.get(key);
    if (currentHeight !== height) {
      itemHeightsRef.current.set(key, height);
      // 触发重新渲染以更新布局
      setLayoutVersion((version) => version + 1);
    }
  }, []);

  // 计算可见范围
  const visibleStart = Math.max(0, scrollTop - overscan * estimatedItemHeight);
  const visibleEnd = scrollTop + containerHeight + overscan * estimatedItemHeight;

  // 计算每列的位置和宽度
  const getColumnStyle = useCallback((colIndex: number) => {
    const columnWidthPercent = 100 / columnCount;
    const left = colIndex * columnWidthPercent;

    return {
      position: 'absolute' as const,
      left: `calc(${left}% + ${colIndex * gap / columnCount}px)`,
      width: `calc(${columnWidthPercent}% - ${gap * (columnCount - 1) / columnCount}px)`,
      top: 0,
    };
  }, [columnCount, gap]);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto h-full"
      style={{ position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {cols.map((col, colIndex) => (
          <div key={colIndex} style={getColumnStyle(colIndex)}>
            {col
              .filter(({ top, height }) => top + height >= visibleStart && top <= visibleEnd)
              .map(({ item, index, top }) => (
                <div
                  key={itemKey(item)}
                  style={{
                    position: 'absolute',
                    top,
                    left: 0,
                    right: 0,
                    paddingLeft: colIndex === 0 ? 0 : gap / 2,
                    paddingRight: colIndex === cols.length - 1 ? 0 : gap / 2,
                  }}
                >
                  <HeightReporter
                    itemKey={itemKey(item)}
                    onHeight={handleItemResize}
                  >
                    {renderItem(item, index)}
                  </HeightReporter>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// 高度测量组件
function HeightReporter({
  itemKey,
  onHeight,
  children,
}: {
  itemKey: string;
  onHeight: (key: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height !== undefined) {
        onHeight(itemKey, height);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [itemKey, onHeight]);

  return <div ref={ref}>{children}</div>;
}
