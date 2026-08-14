import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

type ThemeName = "noir" | "light" | "chroma";

const palettes: Record<
  ThemeName,
  { accent: string; green: string; violet: string; surface: string; line: string; dust: string }
> = {
  noir: {
    accent: "#e1b86f",
    green: "#72ddb0",
    violet: "#9f8cff",
    surface: "#111815",
    line: "#52635c",
    dust: "#dde7df",
  },
  light: {
    accent: "#b77a31",
    green: "#25845c",
    violet: "#725cd4",
    surface: "#f5f1e8",
    line: "#87958a",
    dust: "#5f6e64",
  },
  chroma: {
    accent: "#ffc45f",
    green: "#52e7bd",
    violet: "#9d83ff",
    surface: "#17132b",
    line: "#6b6193",
    dust: "#ece8ff",
  },
};

const projectOrbitIds = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "zenith",
];

function usePageTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const value = document.documentElement.dataset.theme;
    return value === "light" || value === "chroma" ? value : "noir";
  });
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const value = document.documentElement.dataset.theme;
      setTheme(value === "light" || value === "chroma" ? value : "noir");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function Connection({ points, color }: { points: [number, number, number][]; color: string }) {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))),
    [points],
  );
  return (
    <mesh>
      <tubeGeometry args={[curve, 42, 0.012, 7, false]} />
      <meshBasicMaterial color={color} transparent opacity={0.64} />
    </mesh>
  );
}

function SpatialCard({
  position,
  rotation,
  color,
  surface,
  kind,
  index,
  reducedMotion,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  surface: string;
  kind: "asset" | "script" | "shot" | "take";
  index: number;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = "crosshair";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.position.y =
      position[1] + Math.sin(clock.elapsedTime * 0.58 + index * 1.7) * 0.055;
    group.current.rotation.z = rotation[2] + Math.sin(clock.elapsedTime * 0.35 + index) * 0.012;
    const scale = hovered ? 1.055 : 1;
    group.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.1);
  });
  const width = kind === "shot" ? 1.56 : 1.25;
  const height = kind === "shot" ? 1.04 : 0.82;
  return (
    <group
      ref={group}
      position={position}
      rotation={rotation}
      onPointerEnter={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <mesh>
        <boxGeometry args={[width, height, 0.075]} />
        <meshPhysicalMaterial
          color={surface}
          roughness={0.32}
          metalness={0.2}
          transmission={0.14}
          transparent
          opacity={0.96}
          emissive={color}
          emissiveIntensity={hovered ? 0.11 : 0.025}
        />
      </mesh>
      <mesh position={[0, height / 2 - 0.035, 0.045]}>
        <boxGeometry args={[width, 0.035, 0.025]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {kind === "asset" ? (
        <>
          <mesh position={[-0.26, 0.03, 0.055]}>
            <planeGeometry args={[0.48, 0.46]} />
            <meshBasicMaterial color="#38584d" />
          </mesh>
          <mesh position={[0.26, 0.13, 0.063]}>
            <planeGeometry args={[0.25, 0.035]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh position={[0.28, 0.01, 0.063]}>
            <planeGeometry args={[0.31, 0.025]} />
            <meshBasicMaterial color="#6f7b76" />
          </mesh>
          <mesh position={[0.22, -0.11, 0.063]}>
            <planeGeometry args={[0.2, 0.025]} />
            <meshBasicMaterial color="#48524e" />
          </mesh>
        </>
      ) : null}
      {kind === "script"
        ? [0.16, 0.02, -0.12].map((y, line) => (
            <mesh position={[line === 2 ? -0.1 : 0, y, 0.055]} key={y}>
              <planeGeometry args={[line === 2 ? 0.7 : 0.92, 0.025]} />
              <meshBasicMaterial color={line === 0 ? color : "#69746f"} />
            </mesh>
          ))
        : null}
      {kind === "shot" ? (
        <>
          <mesh position={[0, 0.02, 0.055]}>
            <planeGeometry args={[1.24, 0.58]} />
            <meshBasicMaterial color="#263a35" />
          </mesh>
          <mesh position={[-0.42, -0.37, 0.063]}>
            <planeGeometry args={[0.3, 0.026]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh position={[0.3, -0.37, 0.063]}>
            <planeGeometry args={[0.42, 0.022]} />
            <meshBasicMaterial color="#65716c" />
          </mesh>
        </>
      ) : null}
      {kind === "take" ? (
        <>
          {[-0.35, 0, 0.35].map((x, cardIndex) => (
            <mesh position={[x, 0.04, 0.06]} key={x}>
              <planeGeometry args={[0.27, 0.36]} />
              <meshBasicMaterial color={cardIndex === 1 ? color : "#33413c"} />
            </mesh>
          ))}
          <mesh position={[0, -0.26, 0.063]}>
            <planeGeometry args={[0.64, 0.025]} />
            <meshBasicMaterial color="#69746f" />
          </mesh>
        </>
      ) : null}
    </group>
  );
}

function GenerationCore({
  palette,
  ready,
  reducedMotion,
}: {
  palette: (typeof palettes)[ThemeName];
  ready: boolean;
  reducedMotion: boolean;
}) {
  const core = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!core.current || reducedMotion) return;
    core.current.rotation.z = clock.elapsedTime * 0.08;
    core.current.rotation.y = Math.sin(clock.elapsedTime * 0.25) * 0.08;
  });
  return (
    <group ref={core} position={[0.12, 0, 0.22]} rotation={[0.25, 0, 0]}>
      <mesh>
        <torusGeometry args={[0.72, 0.038, 12, 96]} />
        <meshStandardMaterial color={palette.line} metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 3]}>
        <torusGeometry args={[0.49, 0.022, 10, 72]} />
        <meshBasicMaterial color={palette.violet} transparent opacity={0.72} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 3]}>
        <torusGeometry args={[0.3, 0.018, 10, 64]} />
        <meshBasicMaterial color={palette.accent} transparent opacity={0.9} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((blade) => (
        <mesh
          key={blade}
          rotation={[0, 0, (blade / 6) * Math.PI * 2]}
          position={[
            Math.cos((blade / 6) * Math.PI * 2) * 0.17,
            Math.sin((blade / 6) * Math.PI * 2) * 0.17,
            0.02,
          ]}
        >
          <circleGeometry args={[0.14, 3, 0, Math.PI]} />
          <meshPhysicalMaterial
            color={palette.surface}
            roughness={0.2}
            metalness={0.5}
            transparent
            opacity={0.88}
          />
        </mesh>
      ))}
      <pointLight
        color={ready ? palette.green : palette.accent}
        intensity={ready ? 8 : 3}
        distance={4.5}
      />
      <mesh position={[0, 0, 0.09]}>
        <sphereGeometry args={[0.075, 24, 24]} />
        <meshBasicMaterial color={ready ? palette.green : palette.accent} />
      </mesh>
    </group>
  );
}

function Dust({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(270);
    for (let index = 0; index < values.length; index += 3) {
      values[index] = (Math.random() - 0.5) * 9;
      values[index + 1] = (Math.random() - 0.5) * 5;
      values[index + 2] = (Math.random() - 0.5) * 4;
    }
    return values;
  }, []);
  useFrame(({ clock }) => {
    if (points.current && !reducedMotion) points.current.rotation.y = clock.elapsedTime * 0.012;
  });
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={0.018} transparent opacity={0.36} sizeAttenuation />
    </points>
  );
}

function ToneController({ theme }: { theme: ThemeName }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = theme === "light" ? 1.05 : 1.22;
  }, [gl, theme]);
  return null;
}

function UniverseScene({
  theme,
  projectCount,
  workerReady,
  reducedMotion,
}: {
  theme: ThemeName;
  projectCount: number;
  workerReady: boolean;
  reducedMotion: boolean;
}) {
  const palette = palettes[theme];
  const world = useRef<THREE.Group>(null);
  useFrame(({ pointer, clock }) => {
    if (!world.current) return;
    const pointerX = reducedMotion ? 0 : pointer.x * 0.12;
    const pointerY = reducedMotion ? 0 : pointer.y * 0.07;
    world.current.rotation.y = THREE.MathUtils.lerp(world.current.rotation.y, pointerX, 0.035);
    world.current.rotation.x = THREE.MathUtils.lerp(world.current.rotation.x, -pointerY, 0.035);
    world.current.position.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.22) * 0.025;
  });

  return (
    <>
      <ToneController theme={theme} />
      <ambientLight intensity={theme === "light" ? 1.8 : 0.85} />
      <directionalLight
        position={[3, 4, 6]}
        intensity={theme === "light" ? 2.2 : 1.3}
        color={palette.accent}
      />
      <group ref={world} position={[0.15, 0, 0]} rotation={[0.02, -0.05, 0]}>
        <GenerationCore palette={palette} ready={workerReady} reducedMotion={reducedMotion} />
        <SpatialCard
          position={[-2.15, 0.78, 0.3]}
          rotation={[0.03, 0.2, -0.04]}
          color={palette.green}
          surface={palette.surface}
          kind="asset"
          index={0}
          reducedMotion={reducedMotion}
        />
        <SpatialCard
          position={[-1.82, -1.08, -0.2]}
          rotation={[-0.04, 0.16, 0.06]}
          color={palette.violet}
          surface={palette.surface}
          kind="script"
          index={1}
          reducedMotion={reducedMotion}
        />
        <SpatialCard
          position={[2.05, 0.88, -0.05]}
          rotation={[0.02, -0.2, 0.035]}
          color={palette.accent}
          surface={palette.surface}
          kind="shot"
          index={2}
          reducedMotion={reducedMotion}
        />
        <SpatialCard
          position={[2.13, -1.08, 0.35]}
          rotation={[-0.03, -0.16, -0.04]}
          color={palette.violet}
          surface={palette.surface}
          kind="take"
          index={3}
          reducedMotion={reducedMotion}
        />
        <Connection
          points={[
            [-1.55, 0.72, 0.28],
            [-0.8, 0.48, 0.42],
            [-0.48, 0.18, 0.32],
          ]}
          color={palette.green}
        />
        <Connection
          points={[
            [-1.22, -0.95, -0.18],
            [-0.72, -0.55, 0.05],
            [-0.45, -0.2, 0.18],
          ]}
          color={palette.violet}
        />
        <Connection
          points={[
            [0.62, 0.2, 0.25],
            [1.15, 0.55, 0.1],
            [1.3, 0.74, 0],
          ]}
          color={palette.accent}
        />
        <Connection
          points={[
            [0.58, -0.2, 0.28],
            [1.15, -0.62, 0.42],
            [1.5, -0.92, 0.38],
          ]}
          color={palette.violet}
        />
        <group position={[0, -1.84, -1.1]} rotation={[0, 0, 0]}>
          <gridHelper
            args={[11, 32, palette.line, palette.line]}
            material-opacity={0.13}
            material-transparent
          />
        </group>
        {projectOrbitIds
          .slice(0, Math.min(Math.max(projectCount, 3), 9))
          .map((orbitId, index, orbitIds) => {
            const angle = (index / orbitIds.length) * Math.PI * 2;
            return (
              <mesh key={orbitId} position={[Math.cos(angle) * 0.94, Math.sin(angle) * 0.94, -0.3]}>
                <sphereGeometry args={[0.025, 10, 10]} />
                <meshBasicMaterial
                  color={index < projectCount ? palette.accent : palette.line}
                  transparent
                  opacity={0.72}
                />
              </mesh>
            );
          })}
      </group>
      <Dust color={palette.dust} reducedMotion={reducedMotion} />
    </>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* CSS fallback stays usable. */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneFallback() {
  return (
    <div className="universe-fallback" aria-hidden="true">
      <i />
      <i />
      <i />
      <span />
    </div>
  );
}

export function StudioUniverse({
  projectCount,
  workerReady,
}: {
  projectCount: number;
  workerReady: boolean;
}) {
  const theme = usePageTheme();
  const reducedMotion = useReducedMotion();
  return (
    <div
      className="studio-universe"
      role="img"
      aria-label="TakeBoard 三维创作空间：素材和剧本连接生成核心，再形成镜头与候选"
    >
      <SceneBoundary fallback={<SceneFallback />}>
        <Canvas
          className="universe-webgl"
          dpr={[1, 1.6]}
          camera={{ position: [0, 0.1, 7.4], fov: 39, near: 0.1, far: 40 }}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.setClearColor(0x000000, 0);
          }}
        >
          <UniverseScene
            theme={theme}
            projectCount={projectCount}
            workerReady={workerReady}
            reducedMotion={reducedMotion}
          />
        </Canvas>
      </SceneBoundary>
      <div className="universe-vignette" />
      <div className="universe-label label-assets">
        <i /> ASSETS <b>素材输入</b>
      </div>
      <div className="universe-label label-shot">
        <i /> SHOT <b>镜头意图</b>
      </div>
      <div className="universe-label label-takes">
        <i /> TAKES <b>候选谱系</b>
      </div>
      <div className="universe-core-label">
        <span>{workerReady ? "CORE READY" : "CORE STANDBY"}</span>
        <strong>
          GENERATION
          <br />
          ORBIT
        </strong>
        <small>{projectCount} PROJECTS CONNECTED</small>
      </div>
      <div className="universe-depth depth-a">Z / 01</div>
      <div className="universe-depth depth-b">FOCUS 48MM</div>
    </div>
  );
}
