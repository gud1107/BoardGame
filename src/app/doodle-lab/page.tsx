import DoodleLab from "@/games/doodlePhone/DoodleLab";

export const metadata = {
  title: "AI 감별 테스트 · 그림 전화기",
  description: "직접 그린 그림을 그림 전화기 AI가 얼마나 잘 맞히는지 시험해 보는 페이지",
  robots: { index: false },
};

export default function DoodleLabPage() {
  return <DoodleLab />;
}
