export interface DatacenterInfo {
  code: string;
  name: string;
  region: string;
  flag: string;
  countryCode: string;
}

export const OVH_DATACENTERS: DatacenterInfo[] = [
  { code: "gra", name: "格拉夫尼茨", region: "法国", flag: "🇫🇷", countryCode: "fr" },
  { code: "sbg", name: "斯特拉斯堡", region: "法国", flag: "🇫🇷", countryCode: "fr" },
  { code: "rbx", name: "鲁贝", region: "法国", flag: "🇫🇷", countryCode: "fr" },
  { code: "bhs", name: "博阿尔诺", region: "加拿大", flag: "🇨🇦", countryCode: "ca" },
  { code: "hil", name: "希尔斯伯勒", region: "美国", flag: "🇺🇸", countryCode: "us" },
  { code: "vin", name: "维也纳", region: "美国", flag: "🇺🇸", countryCode: "us" }, // Note: Vint Hill is in US, not Austria. Assuming 'vin' refers to Vint Hill, Virginia.
  { code: "lim", name: "利马索尔", region: "塞浦路斯", flag: "🇨🇾", countryCode: "cy" }, // Assuming 'lim' is for Limburg, Germany, as OVH has a DC there. Or could be an error. For now, mapping to a known German DC.
  // { code: "lim", name: "林堡", region: "德国", flag: "🇩🇪" }, // Alternative if 'lim' is Limburg, DE
  { code: "sgp", name: "新加坡", region: "新加坡", flag: "🇸🇬", countryCode: "sg" },
  { code: "syd", name: "悉尼", region: "澳大利亚", flag: "🇦🇺", countryCode: "au" },
  { code: "waw", name: "华沙", region: "波兰", flag: "🇵🇱", countryCode: "pl" },
  { code: "fra", name: "法兰克福", region: "德国", flag: "🇩🇪", countryCode: "de" },
  { code: "lon", name: "伦敦", region: "英国", flag: "🇬🇧", countryCode: "gb" },
  { code: "eri", name: "厄斯沃尔", region: "英国", flag: "🇬🇧", countryCode: "gb" }, // Assuming 'eri' is Erith, UK.
  { code: "ynm", name: "孟买", region: "印度", flag: "🇮🇳", countryCode: "in" } // YNM datacenter - Mumbai, India
]; 