import { memo } from 'react'

export const ClusterLabelNode = memo(function ClusterLabelNode({
  data,
}: {
  data: { label: string; count: number }
}) {
  return (
    <div
      style={{
        padding: '3px 10px',
        background: 'rgba(26,22,8,0.7)',
        border: '1px solid rgba(212,146,11,0.1)',
        borderRadius: 20,
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontSize: 8,
          color: 'rgba(212,146,11,0.5)',
          fontFamily: 'monospace',
          letterSpacing: '0.1em',
        }}
      >
        {data.label.toUpperCase()}
      </span>
      <span
        style={{
          fontSize: 7,
          color: 'rgba(255,255,255,0.2)',
          fontFamily: 'monospace',
          marginLeft: 5,
        }}
      >
        ×{data.count}
      </span>
    </div>
  )
})
