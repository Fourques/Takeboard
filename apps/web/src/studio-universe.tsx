import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
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
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type ThemeName = "noir" | "light" | "chroma";

const palettes: Record<
  ThemeName,
  {
    accent: string;
    signal: string;
    violet: string;
    surface: string;
    raised: string;
    ink: string;
    screen: string;
    line: string;
    dust: string;
  }
> = {
  noir: {
    accent: "#d9b477",
    signal: "#82c9a8",
    violet: "#9f8fe4",
    surface: "#101513",
    raised: "#202824",
    ink: "#f0eee6",
    screen: "#28443a",
    line: "#69776f",
    dust: "#dce5de",
  },
  light: {
    accent: "#a87332",
    signal: "#2e8a63",
    violet: "#715bd0",
    surface: "#e9e4d8",
    raised: "#fffdf6",
    ink: "#202520",
    screen: "#476d5d",
    line: "#86928a",
    dust: "#58675e",
  },
  chroma: {
    accent: "#b89550",
    signal: "#4c9d8c",
    violet: "#8172cf",
    surface: "#e9e9f2",
    raised: "#fffdfb",
    ink: "#24283b",
    screen: "#dfe9e7",
    line: "#81879a",
    dust: "#747b91",
  },
};

function useBoardFaceTexture(
  palette: (typeof palettes)[ThemeName],
  face: "front" | "back",
  ready: boolean,
  projectCount: number,
  recentProjectTitle: string | null,
) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 656;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);

    const width = canvas.width;
    const height = canvas.height;
    const paper = face === "front" ? palette.screen : palette.raised;
    const safeTitle = (recentProjectTitle?.trim() || "未命名项目").slice(0, 18);

    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const wash = context.createRadialGradient(1030, 170, 40, 1030, 170, 620);
    wash.addColorStop(0, `${face === "front" ? palette.signal : palette.violet}2a`);
    wash.addColorStop(0.52, `${palette.accent}0c`);
    wash.addColorStop(1, "transparent");
    context.fillStyle = wash;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = `${palette.line}38`;
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += 64) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.textBaseline = "middle";
    context.fillStyle = palette.accent;
    context.font = "600 22px ui-monospace, monospace";
    context.letterSpacing = "3px";
    context.fillText(
      face === "front" ? "TAKEBOARD / FILMMAKING WORKSPACE" : "TAKEBOARD / CREATIVE LINEAGE",
      68,
      54,
    );
    context.fillStyle = ready ? palette.signal : palette.accent;
    context.beginPath();
    context.arc(1280, 54, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.ink;
    context.textAlign = "right";
    context.font = "600 16px ui-monospace, monospace";
    context.letterSpacing = "2px";
    context.fillText(ready ? "COMFYUI / READY" : "COMFYUI / STANDBY", 1372, 55);
    context.textAlign = "left";
    context.fillStyle = `${palette.line}aa`;
    context.fillRect(68, 91, 1304, 2);

    if (face === "front") {
      context.fillStyle = palette.ink;
      context.font = "500 78px 'Songti SC', STSong, serif";
      context.letterSpacing = "-2px";
      context.fillText("从素材到成片，", 68, 184);
      context.fillText("都在一张画布。", 68, 278);

      context.fillStyle = `${palette.ink}b8`;
      context.font = "400 22px 'PingFang SC', 'Microsoft YaHei', sans-serif";
      context.letterSpacing = "1px";
      context.fillText("连接 ComfyUI，管理素材、镜头、Workflow 与生成结果。", 72, 358);

      context.fillStyle = `${palette.surface}a8`;
      context.roundRect(920, 132, 452, 290, 14);
      context.fill();
      context.strokeStyle = `${palette.accent}b8`;
      context.lineWidth = 3;
      const corners = [
        [946, 158, 1, 1],
        [1346, 158, -1, 1],
        [946, 396, 1, -1],
        [1346, 396, -1, -1],
      ] as const;
      for (const [x, y, dx, dy] of corners) {
        context.beginPath();
        context.moveTo(x, y + dy * 26);
        context.lineTo(x, y);
        context.lineTo(x + dx * 26, y);
        context.stroke();
      }
      context.strokeStyle = `${palette.line}78`;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(1010, 324);
      context.bezierCurveTo(1078, 220, 1170, 222, 1234, 278);
      context.bezierCurveTo(1276, 316, 1298, 294, 1322, 230);
      context.stroke();
      context.fillStyle = palette.accent;
      context.beginPath();
      context.arc(1234, 278, 8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = palette.ink;
      context.font = "500 20px ui-monospace, monospace";
      context.letterSpacing = "1px";
      context.fillText("CURRENT BOARD", 950, 366);
      context.fillStyle = palette.line;
      context.font = "500 15px ui-monospace, monospace";
      context.fillText("SOURCE / SHOT / TAKE", 950, 397);

      context.fillStyle = `${palette.line}a8`;
      context.fillRect(68, 466, 1304, 2);
      const frontMeta = [
        { label: "PROJECTS", value: String(projectCount).padStart(2, "0") },
        { label: "STORAGE", value: "LOCAL" },
        { label: "TRACE", value: "ON" },
      ];
      for (let index = 0; index < frontMeta.length; index += 1) {
        const item = frontMeta[index];
        if (!item) continue;
        const x = 68 + index * 210;
        context.fillStyle = palette.line;
        context.font = "500 14px ui-monospace, monospace";
        context.letterSpacing = "2px";
        context.fillText(item.label, x, 513);
        context.fillStyle = palette.ink;
        context.font = "500 23px ui-monospace, monospace";
        context.fillText(item.value, x, 551);
      }
      context.fillStyle = palette.line;
      context.font = "500 14px ui-monospace, monospace";
      context.fillText("RECENT", 846, 513);
      context.fillStyle = palette.ink;
      context.font = "500 23px 'PingFang SC', sans-serif";
      context.fillText(safeTitle, 846, 551, 510);
    } else {
      context.fillStyle = palette.ink;
      context.font = "500 49px 'Songti SC', STSong, serif";
      context.letterSpacing = "-1px";
      context.fillText("创作谱系", 68, 148);
      context.fillStyle = palette.line;
      context.font = "500 15px ui-monospace, monospace";
      context.letterSpacing = "2px";
      context.fillText("ASSET → SHOT → TAKES / FULL TRACE", 68, 191);

      const sources = [
        { y: 268, label: "IMAGE / 01", color: palette.signal },
        { y: 358, label: "VIDEO / 02", color: palette.accent },
        { y: 448, label: "REF / 03", color: palette.violet },
      ];
      for (const source of sources) {
        context.fillStyle = `${palette.surface}d8`;
        context.roundRect(68, source.y - 32, 220, 64, 8);
        context.fill();
        context.fillStyle = source.color;
        context.fillRect(68, source.y - 32, 5, 64);
        context.fillStyle = palette.ink;
        context.font = "600 15px ui-monospace, monospace";
        context.fillText(source.label, 92, source.y);
        context.fillStyle = source.color;
        context.beginPath();
        context.arc(288, source.y, 6, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = `${palette.surface}e6`;
      context.roundRect(504, 238, 350, 242, 12);
      context.fill();
      context.strokeStyle = `${palette.accent}d8`;
      context.lineWidth = 3;
      context.strokeRect(527, 261, 304, 154);
      context.fillStyle = `${palette.signal}32`;
      context.beginPath();
      context.moveTo(528, 415);
      context.lineTo(628, 326);
      context.lineTo(710, 375);
      context.lineTo(830, 284);
      context.lineTo(830, 415);
      context.closePath();
      context.fill();
      context.fillStyle = palette.ink;
      context.font = "600 17px ui-monospace, monospace";
      context.fillText("SHOT / 04", 527, 448);
      context.textAlign = "right";
      context.fillStyle = palette.accent;
      context.fillText("SELECTED", 831, 448);
      context.textAlign = "left";

      const takes = [
        { y: 260, label: "TAKE 01", color: palette.line },
        { y: 350, label: "TAKE 02", color: palette.violet },
        { y: 440, label: "TAKE 03", color: palette.signal },
      ];
      for (const take of takes) {
        context.fillStyle = `${palette.surface}d8`;
        context.roundRect(1060, take.y - 33, 312, 66, 8);
        context.fill();
        context.fillStyle = `${take.color}58`;
        context.fillRect(1072, take.y - 21, 62, 42);
        context.fillStyle = palette.ink;
        context.font = "600 15px ui-monospace, monospace";
        context.fillText(take.label, 1160, take.y - 7);
        context.fillStyle = take.color;
        context.font = "500 13px ui-monospace, monospace";
        context.fillText(take.label === "TAKE 02" ? "SELECTED" : "GENERATED", 1160, take.y + 16);
      }

      context.lineWidth = 2;
      for (const source of sources) {
        context.strokeStyle = `${source.color}a8`;
        context.beginPath();
        context.moveTo(294, source.y);
        context.bezierCurveTo(388, source.y, 406, 359, 504, 359);
        context.stroke();
      }
      for (const take of takes) {
        context.strokeStyle = `${take.color}a8`;
        context.beginPath();
        context.moveTo(854, 359);
        context.bezierCurveTo(942, 359, 966, take.y, 1054, take.y);
        context.stroke();
      }
      for (const x of [294, 504, 854, 1054]) {
        context.fillStyle = palette.accent;
        context.beginPath();
        context.arc(x, 359, 5, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = `${palette.line}a8`;
      context.fillRect(68, 535, 1304, 2);
      context.fillStyle = palette.line;
      context.font = "500 14px ui-monospace, monospace";
      context.fillText("PROJECT", 68, 578);
      context.fillStyle = palette.ink;
      context.font = "500 20px 'PingFang SC', sans-serif";
      context.fillText(safeTitle, 170, 578, 420);
      context.textAlign = "right";
      context.fillStyle = palette.line;
      context.font = "500 14px ui-monospace, monospace";
      context.fillText("LOCAL / TRACEABLE / NON-DESTRUCTIVE", 1372, 578);
      context.textAlign = "left";
    }

    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 4;
    result.needsUpdate = true;
    return result;
  }, [face, palette, projectCount, ready, recentProjectTitle]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

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

function EnvironmentController({ theme }: { theme: ThemeName }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = theme === "noir" ? 1.18 : 1.08;
    const generator = new THREE.PMREMGenerator(gl);
    const environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    return () => {
      scene.environment = null;
      environment.dispose();
      generator.dispose();
    };
  }, [gl, scene, theme]);
  return null;
}

function Dust({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(210);
    for (let index = 0; index < values.length; index += 3) {
      values[index] = (Math.random() - 0.5) * 8;
      values[index + 1] = (Math.random() - 0.5) * 4.6;
      values[index + 2] = (Math.random() - 0.5) * 3.5;
    }
    return values;
  }, []);
  useFrame(({ clock }) => {
    if (points.current && !reducedMotion) points.current.rotation.y = clock.elapsedTime * 0.01;
  });
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={0.016} transparent opacity={0.25} sizeAttenuation />
    </points>
  );
}

function FrontFace({
  palette,
  ready,
  projectCount,
  recentProjectTitle,
}: {
  palette: (typeof palettes)[ThemeName];
  ready: boolean;
  projectCount: number;
  recentProjectTitle: string | null;
}) {
  const texture = useBoardFaceTexture(palette, "front", ready, projectCount, recentProjectTitle);
  return (
    <group position={[0, -0.16, 0.116]}>
      <mesh>
        <planeGeometry args={[2.68, 1.22]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function BackFace({
  palette,
  ready,
  projectCount,
  recentProjectTitle,
}: {
  palette: (typeof palettes)[ThemeName];
  ready: boolean;
  projectCount: number;
  recentProjectTitle: string | null;
}) {
  const texture = useBoardFaceTexture(palette, "back", ready, projectCount, recentProjectTitle);
  return (
    <group position={[0, -0.15, -0.116]} rotation={[0, Math.PI, 0]}>
      <mesh>
        <planeGeometry args={[2.7, 1.24]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Clapper({ palette }: { palette: (typeof palettes)[ThemeName] }) {
  const stripeShape = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.21, -0.18);
    shape.lineTo(0.06, -0.18);
    shape.lineTo(0.21, 0.18);
    shape.lineTo(-0.06, 0.18);
    shape.closePath();
    return shape;
  }, []);
  return (
    <group position={[0, 0.94, 0.02]} rotation={[0, 0, -0.035]}>
      <mesh>
        <boxGeometry args={[3.2, 0.38, 0.22]} />
        <meshPhysicalMaterial
          color={palette.surface}
          roughness={0.25}
          metalness={0.5}
          clearcoat={0.7}
          clearcoatRoughness={0.2}
        />
      </mesh>
      {[-1.3, -0.86, -0.42, 0.02, 0.46, 0.9, 1.34].map((x, index) => (
        <group key={x}>
          <mesh position={[x, 0, 0.116]}>
            <shapeGeometry args={[stripeShape]} />
            <meshBasicMaterial color={palette.accent} transparent opacity={0.9} />
          </mesh>
          <mesh position={[x, 0, -0.116]} rotation={[0, Math.PI, 0]}>
            <shapeGeometry args={[stripeShape]} />
            <meshBasicMaterial
              color={index % 2 === 0 ? palette.signal : palette.violet}
              transparent
              opacity={0.82}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[-1.47, -0.03, 0.13]}>
        <circleGeometry args={[0.055, 20]} />
        <meshBasicMaterial color={palette.signal} />
      </mesh>
    </group>
  );
}

function BoardArtifact({
  palette,
  ready,
  reducedMotion,
  projectCount,
  recentProjectTitle,
}: {
  palette: (typeof palettes)[ThemeName];
  ready: boolean;
  reducedMotion: boolean;
  projectCount: number;
  recentProjectTitle: string | null;
}) {
  const artifact = useRef<THREE.Group>(null);
  const target = useRef({ x: -0.06, y: -0.12 });
  const drag = useRef({ active: false, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.body.style.cursor = dragging ? "grabbing" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [dragging]);

  useFrame(({ clock }, delta) => {
    if (!artifact.current) return;
    if (!drag.current.active && !reducedMotion) target.current.y += delta * 0.055;
    artifact.current.rotation.x = THREE.MathUtils.damp(
      artifact.current.rotation.x,
      target.current.x,
      7,
      delta,
    );
    artifact.current.rotation.y = THREE.MathUtils.damp(
      artifact.current.rotation.y,
      target.current.y,
      7,
      delta,
    );
    artifact.current.position.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.55) * 0.035;
  });

  const resetView = () => {
    target.current = { x: -0.06, y: -0.12 };
  };
  const beginDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const targetElement = event.nativeEvent.target as Element | null;
    targetElement?.setPointerCapture(event.pointerId);
    drag.current = { active: true, x: event.clientX, y: event.clientY };
    setDragging(true);
  };
  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current.active) return;
    event.stopPropagation();
    const deltaX = event.clientX - drag.current.x;
    const deltaY = event.clientY - drag.current.y;
    target.current.y += deltaX * 0.009;
    target.current.x = THREE.MathUtils.clamp(target.current.x + deltaY * 0.006, -0.72, 0.72);
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
  };
  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    drag.current.active = false;
    setDragging(false);
    const targetElement = event.nativeEvent.target as Element | null;
    if (targetElement?.hasPointerCapture(event.pointerId)) {
      targetElement.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <group>
      <group ref={artifact} rotation={[-0.06, -0.12, 0]}>
        <mesh position={[0, -0.15, 0]}>
          <boxGeometry args={[3.12, 1.82, 0.22]} />
          <meshPhysicalMaterial
            color={palette.surface}
            roughness={0.24}
            metalness={0.48}
            clearcoat={0.72}
            clearcoatRoughness={0.22}
          />
        </mesh>
        <FrontFace
          palette={palette}
          ready={ready}
          projectCount={projectCount}
          recentProjectTitle={recentProjectTitle}
        />
        <BackFace
          palette={palette}
          ready={ready}
          projectCount={projectCount}
          recentProjectTitle={recentProjectTitle}
        />
        <Clapper palette={palette} />
      </group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the labelled canvas uses this stationary transparent Three.js mesh for pointer rotation; keyboard users have a separate reset button */}
      <mesh
        position={[0, 0, 1.2]}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          event.stopPropagation();
          resetView();
        }}
      >
        <planeGeometry args={[4.5, 3.25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, -1.58, -0.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.8, 64]} />
        <meshBasicMaterial color={palette.surface} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.2, -1.1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.15, 0.008, 6, 120]} />
        <meshBasicMaterial color={palette.line} transparent opacity={0.3} />
      </mesh>
      <pointLight
        position={[0.4, 0.5, 2.6]}
        color={ready ? palette.signal : palette.accent}
        intensity={ready ? 5.2 : 3.1}
        distance={6}
      />
    </group>
  );
}

function ArtifactScene({
  theme,
  workerReady,
  reducedMotion,
  projectCount,
  recentProjectTitle,
}: {
  theme: ThemeName;
  workerReady: boolean;
  reducedMotion: boolean;
  projectCount: number;
  recentProjectTitle: string | null;
}) {
  const palette = palettes[theme];
  const brightTheme = theme !== "noir";
  const { size } = useThree();
  const artifactScale = size.width < 500 ? 0.62 : size.width < 880 ? 0.82 : 1;
  return (
    <>
      <EnvironmentController theme={theme} />
      <ambientLight intensity={brightTheme ? 1.65 : 0.72} />
      <directionalLight
        position={[-3, 4, 5]}
        intensity={brightTheme ? 2.3 : 1.7}
        color={palette.accent}
      />
      <directionalLight position={[4, -1, 3]} intensity={1.1} color={palette.signal} />
      <group position={[0, 0, 0]} scale={artifactScale}>
        <BoardArtifact
          palette={palette}
          ready={workerReady}
          reducedMotion={reducedMotion}
          projectCount={projectCount}
          recentProjectTitle={recentProjectTitle}
        />
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
    /* The CSS fallback keeps project access usable when WebGL is unavailable. */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneFallback() {
  return (
    <div className="universe-fallback artifact-fallback" aria-hidden="true">
      <i />
      <i />
      <i />
      <span />
    </div>
  );
}

export function StudioUniverse({
  workerReady,
  projectCount,
  recentProjectTitle,
}: {
  workerReady: boolean;
  projectCount: number;
  recentProjectTitle: string | null;
}) {
  const theme = usePageTheme();
  const reducedMotion = useReducedMotion();
  return (
    <div
      className="studio-universe artifact-universe"
      role="img"
      aria-label="可旋转的 TakeBoard 三维导演板，正面是产品主页，背面展示创作谱系"
    >
      <SceneBoundary fallback={<SceneFallback />}>
        <Canvas
          className="universe-webgl"
          dpr={[1, 1.5]}
          camera={{ position: [0, 0.08, 6.5], fov: 32, near: 0.1, far: 40 }}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.setClearColor(0x000000, 0);
            gl.setClearAlpha(0);
            scene.background = null;
          }}
        >
          <ArtifactScene
            theme={theme}
            workerReady={workerReady}
            reducedMotion={reducedMotion}
            projectCount={projectCount}
            recentProjectTitle={recentProjectTitle}
          />
        </Canvas>
      </SceneBoundary>
    </div>
  );
}
