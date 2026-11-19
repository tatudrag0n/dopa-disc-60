/**
 * マルチタッチ（2 本指）対策の共通判定。
 *
 * `onDown` で最初に受け取った `pointerId` を操作の持ち主として保持し、
 * `onMove` / `onUp` では同じ `pointerId` のイベントだけを反映する。
 * 2 本目の指の座標を混ぜると、描画や回転の点列が飛んで
 * 飛距離が異常値になるため、持ち主以外は丸ごと無視する。
 */
export function ownsPointer(owner: number | null | undefined, incoming: number): boolean {
  return typeof owner === "number" && owner === incoming;
}
