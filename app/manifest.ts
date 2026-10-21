import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ORDERFLOW 주문 운영",
    short_name: "ORDERFLOW",
    description: "사진으로 고르고 제출하는 고객 주문서와 주문·재고·배송 운영 앱",
    start_url: "/order/fresh-market",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#173c32",
    lang: "ko-KR",
    icons: [
      { src: "/visuals/orderflow-mark.webp", sizes: "any", type: "image/webp", purpose: "any" },
      { src: "/visuals/orderflow-mark.webp", sizes: "any", type: "image/webp", purpose: "maskable" },
    ],
  };
}
