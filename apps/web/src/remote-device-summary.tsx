import type { RemoteDeviceStatus } from "@takeboard/contracts";

export function RemoteDeviceSummary({ device }: { device: RemoteDeviceStatus }) {
  return (
    <div className="remote-device-summary">
      <div className="generation-service-heading">
        <small>{device.system.name || "设备信息读取不完整"}</small>
        <small>{device.system.platform || "系统未知"}</small>
      </div>
      {device.connection === "connected" ? (
        device.gpu.state === "unavailable" ? (
          <p>GPU 状态读取失败</p>
        ) : (
          device.gpu.devices.map((gpu) => (
            <div className="run-settings" key={gpu.id}>
              <strong>{gpu.name}</strong>
              <dl>
                <div>
                  <dt>显存</dt>
                  <dd>
                    {(gpu.usedMiB / 1024).toFixed(1)} / {(gpu.totalMiB / 1024).toFixed(1)} GB
                  </dd>
                </div>
                <div>
                  <dt>可用</dt>
                  <dd>{(gpu.freeMiB / 1024).toFixed(1)} GB</dd>
                </div>
                <div>
                  <dt>GPU 利用率</dt>
                  <dd>{gpu.utilization}%</dd>
                </div>
              </dl>
            </div>
          ))
        )
      ) : null}
      <details className="run-raw">
        <summary>设备详情</summary>
        <p>检查时间：{new Date(device.checkedAt).toLocaleTimeString()}</p>
        {device.system.availableMemoryMiB !== null ? (
          <p>可用内存 {(device.system.availableMemoryMiB / 1024).toFixed(1)} GB</p>
        ) : null}
        {device.gpu.processesKnown ? (
          <ul>
            {device.gpu.processes.map((process) => (
              <li key={`${process.pid}-${process.name}`}>
                {process.name} · PID {process.pid} · {(process.usedMiB / 1024).toFixed(1)} GB
              </li>
            ))}
          </ul>
        ) : (
          <p>进程信息不可用</p>
        )}
        {device.diagnostics.length ? <pre>{device.diagnostics.join("\n")}</pre> : null}
      </details>
    </div>
  );
}
