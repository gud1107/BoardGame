/**
 * Real photos for the asset lots that have a freely-licensed image on
 * Wikimedia Commons (HQ buildings, products, physical coins — never a bare
 * logo). Files are 800px-wide Commons thumbnails, unmodified apart from the
 * resize, stored in public/images/great-legacy/photos/<assetId>.jpg.
 *
 * Every CC-BY / CC-BY-SA photo MUST be shown with its credit (author,
 * license, source link) — LotCatalogCard renders it under the lot photo.
 * Assets missing here (카카오·솔라나·리플·도지·페페·테마주 2종, and all
 * event cards) had no usable free photo and keep their SVG illustration.
 */
export interface LotPhotoCredit {
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

export const LOT_PHOTOS: Record<string, LotPhotoCredit> = {
  "us-bigtech-1": {
    author: "Daniel L. Lu",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Aerial_view_of_Apple_Park_dllu.jpg",
  },
  "us-bigtech-2": {
    author: "Grendelkhan",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Googleplex_with_Pride_colors_2015.gk.jpg",
  },
  "kr-bigtech-2": {
    author: "Maskkwon",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:NAVER_Green_Factory.jpg",
  },
  "us-bluechip-1": {
    author: "Coolcaesar",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:NVIDIA_Headquarters.jpg",
  },
  "us-bluechip-2": {
    author: "Coolcaesar",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Building92microsoft.jpg",
  },
  "kr-bluechip-1": {
    author: "Oskar Alexanderson",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Samsung_headquarters.jpg",
  },
  "kr-bluechip-2": {
    author: "TTTNIS",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Hyundai_Ioniq_5.jpg",
  },
  "us-meme-1": {
    author: "Alexander-93",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Tesla_Model_S_Plaid_Autofr%C3%BChling_Ulm_IMG_9278_(cropped).jpg",
  },
  "us-meme-2": {
    author: "Dwight Burdette",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:GameStop_store_Ypsilanti.JPG",
  },
  "cr-bluechip-1": {
    author: "Gage Skidmore",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:25_BTC_Gold_Casascius_coin_2011_by_Gage_Skidmore.jpg",
  },
  "cr-bluechip-2": {
    author: "Ivan Radic",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Close-up_of_a_physical_Ethereum_coin_(51002904687).jpg",
  },
};

/** Image for an asset lot: the real photo when one is licensed, otherwise the SVG illustration. */
export function assetImageSrc(assetId: string): string {
  return LOT_PHOTOS[assetId] ? `/images/great-legacy/photos/${assetId}.jpg` : `/images/great-legacy/${assetId}.svg`;
}
