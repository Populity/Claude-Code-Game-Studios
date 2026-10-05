import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

const P: Record<string, React.ReactNode> = {
  home: <Path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  search: <><Circle cx="11" cy="11" r="7.5" /><Path d="m21 21-4.6-4.6" /></>,
  plus: <><Rect x="3" y="3" width="18" height="18" rx="5" /><Path d="M12 8v8M8 12h8" /></>,
  trophy: <><Path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><Path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  bolt: <Path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  camera: <><Path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Circle cx="12" cy="13" r="4" /></>,
  image: <><Rect x="3" y="3" width="18" height="18" rx="4" /><Circle cx="9" cy="9" r="2" /><Path d="m21 15-5-5-11 11" /></>,
  link: <><Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  menu: <Path d="M4 7h16M4 12h16M4 17h16" />,
  dots: <><Circle cx="5" cy="12" r="1.4" /><Circle cx="12" cy="12" r="1.4" /><Circle cx="19" cy="12" r="1.4" /></>,
  flag: <Path d="M5 21V4h11l-1.5 4L16 12H5" />,
  swords: <Path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2" />,
  grid: <><Rect x="3" y="3" width="7" height="7" /><Rect x="14" y="3" width="7" height="7" /><Rect x="3" y="14" width="7" height="7" /><Rect x="14" y="14" width="7" height="7" /></>,
  close: <Path d="M6 6l12 12M18 6 6 18" />,
  volume: <><Path d="M4 9h4l5-4v14l-5-4H4z" /><Path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  mute: <><Path d="M4 9h4l5-4v14l-5-4H4z" /><Path d="m17 9 5 6M22 9l-5 6" /></>,
  check: <Path d="M5 12.5 10 17 19 7" />,
};
export type IconName = keyof typeof P;
export function Icon({ name, size = 26, color = "#f5f5f5", width = 2, fill = "none" }: { name: IconName; size?: number; color?: string; width?: number; fill?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">{P[name]}</Svg>;
}
