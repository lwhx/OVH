import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useAPI } from "@/context/APIContext";
import axios from "axios";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cpu, Database, Wifi, HardDrive, CheckSquare, Square, Settings, ArrowRightLeft, Clock, Search, MapPin, ChevronDown, RefreshCw, Info } from "lucide-react";
import { apiEvents } from "@/context/APIContext";
import { OVH_DATACENTERS, DatacenterInfo } from "@/config/ovhConstants"; // Import from new location

// Backend API URL (update this to match your backend)
const API_URL = 'http://localhost:5000/api';

// 定义刷新间隔（30分钟）
const REFRESH_INTERVAL = 30 * 60 * 1000;

// 定义缓存相关的常量
const CACHE_KEY = 'ovh-servers-cache';
const CACHE_EXPIRY = 30 * 60 * 1000; // 缓存30分钟过期

// 全局CSS样式
const globalStyles = `
.datacenter-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.datacenter-scrollbar::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.datacenter-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(100, 255, 218, 0.2);
  border-radius: 10px;
}
.datacenter-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 255, 218, 0.4);
}

/* 动画延迟 */
.animation-delay-1000 {
  animation-delay: 1s;
}
.animation-delay-2000 {
  animation-delay: 2s;
}
.animation-delay-3000 {
  animation-delay: 3s;
}

/* 写意勾勾绘制动画 */
@keyframes draw {
  from {
    stroke-dashoffset: 20;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes checkmark-appear {
  0% {
    transform: scale(0) rotate(-12deg);
    opacity: 0;
  }
  50% {
    transform: scale(1.2) rotate(3deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(3deg);
    opacity: 1;
  }
}
`;

interface ServerOption {
  label: string;
  value: string;
  family?: string;
  isDefault?: boolean;
}

interface ServerPlan {
  planCode: string;
  name: string;
  description?: string;
  cpu: string;
  memory: string;
  storage: string;
  bandwidth: string;
  vrackBandwidth: string;
  defaultOptions: ServerOption[];
  availableOptions: ServerOption[];
  datacenters: {
    datacenter: string;
    dcName: string;
    region: string;
    availability: string;
    countryCode: string;
  }[];
}

const ServersPage = () => {
  const { isAuthenticated } = useAPI();
  const [servers, setServers] = useState<ServerPlan[]>([]);
  const [filteredServers, setFilteredServers] = useState<ServerPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDatacenter, setSelectedDatacenter] = useState<string>("all");
  const [datacenters, setDatacenters] = useState<string[]>([]);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [availability, setAvailability] = useState<Record<string, Record<string, string>>>({});
  // 为每个服务器的数据中心选择状态设置映射
  const [selectedDatacenters, setSelectedDatacenters] = useState<Record<string, Record<string, boolean>>>({});
  // 用于跟踪当前选中的服务器
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  // 保存每个服务器的选中选项
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  // 上次更新时间
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // 定时器引用
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 标记是否已从缓存加载
  const hasLoadedFromCache = useRef(false);
  // 新增：标记是否真正在从API获取数据，防止并发
  const [isActuallyFetching, setIsActuallyFetching] = useState(false);

  // 检查缓存是否过期
  const isCacheExpired = (): boolean => {
    const cacheData = localStorage.getItem(CACHE_KEY);
    if (!cacheData) return true;
    
    try {
      const { timestamp } = JSON.parse(cacheData);
      const now = new Date().getTime();
      return now - timestamp > CACHE_EXPIRY;
    } catch (error) {
      console.error("解析缓存数据出错:", error);
      return true;
    }
  };

  // 从缓存加载数据
  const loadFromCache = (): boolean => {
    try {
      const cacheData = localStorage.getItem(CACHE_KEY);
      if (!cacheData) return false;
      
      const { data, timestamp } = JSON.parse(cacheData);
      if (!data || !Array.isArray(data)) return false;
      
      console.log("从缓存加载服务器数据...");
      setServers(data);
      setFilteredServers(data);
      setLastUpdated(new Date(timestamp));
      
      // 初始化数据中心选择状态
      const dcSelections: Record<string, Record<string, boolean>> = {};
      data.forEach(server => {
        dcSelections[server.planCode] = {};
        // 对所有固定的数据中心进行初始化
        OVH_DATACENTERS.forEach(dc => {
          dcSelections[server.planCode][dc.code.toUpperCase()] = false;
        });
      });
      
      setSelectedDatacenters(dcSelections);
      setIsLoading(false);
      return true;
    } catch (error) {
      console.error("加载缓存数据出错:", error);
      return false;
    }
  };

  // 保存数据到缓存
  const saveToCache = (data: ServerPlan[]) => {
    try {
      const cacheData = {
        data,
        timestamp: new Date().getTime()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log("服务器数据已保存到缓存");
    } catch (error) {
      console.error("保存数据到缓存出错:", error);
    }
  };

  // Fetch servers from the backend
  const fetchServers = async (forceRefresh = false) => {
    // 如果不是强制刷新，并且已从缓存加载过数据，并且缓存未过期，则跳过
    if (!forceRefresh && hasLoadedFromCache.current && !isCacheExpired()) {
      console.log("使用现有数据，缓存未过期，跳过API请求");
      return;
    }

    // 如果当前已经在从API获取数据，则跳过此次请求
    if (isActuallyFetching) {
      console.log("已在从API获取服务器数据，跳过此次冗余请求");
      return;
    }
    
    setIsLoading(true);
    setIsActuallyFetching(true); // 标记开始从API获取
    try {
      console.log(`开始从API获取服务器数据... (forceRefresh: ${forceRefresh})`);
      const response = await axios.get(`${API_URL}/servers`, {
        params: { showApiServers: isAuthenticated }
      });
      
      // 调试输出查看原始服务器数据
      console.log("原始服务器数据:", response.data);
      
      // 确保我们从正确的数据结构中获取服务器列表
      let serversList = [];
      
      if (response.data && typeof response.data === 'object') {
        if (Array.isArray(response.data)) {
          serversList = response.data;
        } else if (response.data.servers && Array.isArray(response.data.servers)) {
          serversList = response.data.servers;
        }
      }
      
      // 进一步校验服务器列表的有效性
      if (!Array.isArray(serversList)) {
        console.error("无效的服务器列表格式:", serversList);
        toast.error("获取服务器列表失败: 数据格式错误");
        setIsLoading(false);
        return;
      }
      
      console.log("解析后的服务器列表:", serversList);
      console.log(`获取到 ${serversList.length} 台服务器`);
      
      // 确保每个服务器都有正确的数据结构
      const formattedServers = serversList.map((server: ServerPlan) => {
        // 验证必要字段是否存在
        const formattedServer = {
          ...server,
          planCode: server.planCode || "未知",
          name: server.name || "未命名服务器",
          description: server.description || "",
          cpu: server.cpu || "N/A",
          memory: server.memory || "N/A", 
          storage: server.storage || "N/A",
          bandwidth: server.bandwidth || "N/A",
          vrackBandwidth: server.vrackBandwidth || "N/A",
          defaultOptions: Array.isArray(server.defaultOptions) ? server.defaultOptions : [],
          availableOptions: Array.isArray(server.availableOptions) ? server.availableOptions : [],
          datacenters: Array.isArray(server.datacenters) ? server.datacenters : []
        };
        
        // 显示额外调试信息
        console.log(`服务器 ${formattedServer.planCode} 硬件信息:`, {
          cpu: formattedServer.cpu,
          memory: formattedServer.memory,
          storage: formattedServer.storage,
          bandwidth: formattedServer.bandwidth
        });
        
        return formattedServer;
      });
      
      console.log("格式化后的服务器列表:", formattedServers);
      
      // 设置使用固定的数据中心列表
      const allDatacenters = OVH_DATACENTERS.map(dc => dc.code.toUpperCase());
      setDatacenters(allDatacenters);
      
      // 初始化数据中心选择状态
      const dcSelections: Record<string, Record<string, boolean>> = {};
      formattedServers.forEach(server => {
        dcSelections[server.planCode] = {};
        // 对所有固定的数据中心进行初始化
        OVH_DATACENTERS.forEach(dc => {
          dcSelections[server.planCode][dc.code.toUpperCase()] = false;
        });
      });
      
      setSelectedDatacenters(dcSelections);
      setServers(formattedServers);
      setFilteredServers(formattedServers);
      setIsLoading(false); // isLoading 在这里可以先置为false，因为数据已获取并设置
      // 更新最后刷新时间
      setLastUpdated(new Date());
      
      // 保存到缓存
      saveToCache(formattedServers);
      
      // 检查是否有服务器缺少硬件信息
      const missingInfoServers = formattedServers.filter(
        server => server.cpu === "N/A" || server.memory === "N/A" || server.storage === "N/A"
      );
      
      if (missingInfoServers.length > 0) {
        console.warn("以下服务器缺少硬件信息:", missingInfoServers.map(s => s.planCode).join(", "));
      }
      
    } catch (error) {
      console.error("获取服务器列表时出错:", error);
      toast.error("获取服务器列表失败");
      setIsLoading(false); // 确保isLoading在出错时也更新
      
      // 如果API请求失败但有缓存数据，尝试从缓存加载
      if (!hasLoadedFromCache.current) {
        const loaded = loadFromCache();
        if (loaded) {
          toast.info("使用缓存数据显示服务器列表");
          hasLoadedFromCache.current = true;
        }
      }
    } finally {
      setIsActuallyFetching(false); // 确保无论成功或失败都重置状态
    }
  };

  // 格式化日期时间的辅助函数
  const formatDateTime = (date: Date | null): string => {
    if (!date) return "未知";
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) {
      return "刚刚";
    } else if (diffMins < 60) {
      return `${diffMins} 分钟前`;
    } else {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `今天 ${hours}:${minutes}`;
    }
  };

  // Format server specifications for better display
  const formatServerSpec = (value: string, type: string): string => {
    if (!value || value === "N/A") return "暂无数据";
    
    // 清理值
    value = value.trim();
    
    // 对于CPU，尝试格式化
    if (type === "CPU") {
      // 已经有完整描述的情况
      if (value.toLowerCase().includes("intel") || 
          value.toLowerCase().includes("amd") || 
          value.toLowerCase().includes("ryzen") || 
          value.toLowerCase().includes("xeon") || 
          value.toLowerCase().includes("epyc")) {
        return value;
      }
      
      // 处理OVH API返回的CPU值格式 (通常是planCode)
      const cpuNameMatch = value.match(/cpu-([a-z0-9-]+)/i);
      if (cpuNameMatch) {
        // 尝试从planCode中提取CPU型号
        const cpuName = cpuNameMatch[1]
          .replace(/-/g, ' ')
          .replace(/(\d+)c(\d+)t/i, '$1核$2线程')
          .replace(/(\d+)c/i, '$1核')
          .replace(/i(\d+)/i, 'Intel Core i$1');
        
        return cpuName.charAt(0).toUpperCase() + cpuName.slice(1);
      }
      
      // 尝试从不同格式中提取信息
      if (value.includes("x")) {
        // 已经是格式 "4 x Intel Xeon"
        return value;
      } else if (!isNaN(Number(value))) {
        return `${value} 核心`;
      }
      
      // 专门处理core关键词
      if (value.toLowerCase().includes("core")) {
        return value;
      }
      
      return value;
    }
    
    // 对于内存，转换为GB表示
    if (type === "内存") {
      // 已经包含单位
      if (value.toLowerCase().includes("gb") || 
          value.toLowerCase().includes("mb") || 
          value.toLowerCase().includes("tb")) {
        return value;
      } 
      
      // 处理OVH API返回的内存值格式
      const ramMatch = value.match(/ram-(\d+)g/i);
      if (ramMatch) {
        return `${ramMatch[1]} GB`;
      }
      
      // 尝试处理纯数字
      if (!isNaN(Number(value))) {
        const num = Number(value);
        // 大于1000的可能是MB为单位
        if (num > 1000) {
          return `${(num/1024).toFixed(0)} GB`;
        }
        return `${num} GB`;
      }
      
      // 尝试提取数字部分
      const numMatch = value.match(/(\d+)/);
      if (numMatch && numMatch[1]) {
        const num = parseInt(numMatch[1]);
        if (num > 0) {
          if (num > 1000) {
            return `${(num/1024).toFixed(0)} GB`;
          }
          return `${num} GB`;
        }
      }
      
      return value;
    }
    
    // 对于存储
    if (type === "存储") {
      // 已经包含单位
      if (value.toLowerCase().includes("gb") || 
          value.toLowerCase().includes("tb") || 
          value.toLowerCase().includes("ssd") || 
          value.toLowerCase().includes("hdd") || 
          value.toLowerCase().includes("nvme")) {
        return value;
      }
      
      // 处理OVH API返回的存储值格式
      const storageMatch = value.match(/(raid|softraid)-(\d+)x(\d+)(ssd|hdd|nvme)/i);
      if (storageMatch) {
        const raidType = storageMatch[1].toUpperCase();
        const count = storageMatch[2];
        const size = storageMatch[3];
        const diskType = storageMatch[4].toUpperCase();
        return `${raidType} ${count}x ${size}GB ${diskType}`;
      }
      
      // 尝试处理纯数字
      if (!isNaN(Number(value))) {
        const num = Number(value);
        if (num >= 1000) {
          return `${(num/1000).toFixed(1)} TB`;
        }
        return `${num} GB`;
      }
      
      // 尝试匹配常见的存储格式，如 "2x500GB SSD"
      const simpleStorageMatch = value.match(/(\d+)x(\d+)(GB|TB|G|T)?/i);
      if (simpleStorageMatch) {
        const count = parseInt(simpleStorageMatch[1]);
        const size = parseInt(simpleStorageMatch[2]);
        const unit = simpleStorageMatch[3]?.toUpperCase() || "GB";
        const sizeStr = unit.includes("T") ? `${size}TB` : `${size}GB`;
        return `${count}x ${sizeStr}`;
      }
      
      return value;
    }
    
    // 对于带宽
    if (type.includes("带宽") && !type.includes("内网")) {
      // 已经包含单位或特殊格式
      if (value.toLowerCase().includes("gbps") || 
          value.toLowerCase().includes("mbps") || 
          value.toLowerCase().includes("gbit") || 
          value.toLowerCase().includes("mbit") ||
          value.toLowerCase().includes("流量") ||
          value.toLowerCase().includes("无限") ||
          value.toLowerCase().includes("保证")) {
        return value;
      }
      
      // 处理带宽和流量组合格式 "traffic-5tb-100-24sk-apac"
      const combinedTrafficMatch = value.match(/traffic-(\d+)(tb|gb|mb)-(\d+)/i);
      if (combinedTrafficMatch) {
        const trafficSize = combinedTrafficMatch[1];
        const trafficUnit = combinedTrafficMatch[2].toUpperCase();
        const bandwidth = combinedTrafficMatch[3];
        return `${bandwidth} Mbps / ${trafficSize} ${trafficUnit}流量`;
      }
      
      // 处理无限流量
      if (value.toLowerCase().includes("unlimited")) {
        return "无限流量";
      }
      
      // 处理保证带宽
      if (value.toLowerCase().includes("guarantee")) {
        const bwMatch = value.match(/(\d+)/);
        if (bwMatch) {
          return `${bwMatch[1]} Mbps (保证带宽)`;
        }
        return "保证带宽";
      }
      
      // 处理OVH API返回的带宽值格式
      const trafficMatch = value.match(/traffic-(\d+)(tb|gb|mb|m|g)/i);
      if (trafficMatch) {
        const size = trafficMatch[1];
        const unit = trafficMatch[2].toLowerCase();
        if (unit === 'tb' || unit === 't') {
          return `${size} TB流量`;
        } else if (unit === 'gb' || unit === 'g') {
          return `${size} GB流量`;
        } else {
          return `${size} MB流量`;
        }
      }
      
      // 处理bandwidth格式
      const bandwidthMatch = value.match(/bandwidth-(\d+)/i);
      if (bandwidthMatch) {
        const bwValue = parseInt(bandwidthMatch[1]);
        if (bwValue >= 1000) {
          return `${bwValue/1000} Gbps`.replace(".0 ", " ");
        }
        return `${bwValue} Mbps`;
      }
      
      // 尝试处理纯数字
      if (!isNaN(Number(value))) {
        const num = Number(value);
        if (num >= 1000) {
          return `${(num/1000).toFixed(1)} Gbps`;
        }
        return `${num} Mbps`;
      }
      
      // 尝试匹配带宽格式
      const bwMatch = value.match(/(\d+)([mg])/i);
      if (bwMatch) {
        const size = parseInt(bwMatch[1]);
        const unit = bwMatch[2].toLowerCase();
        if (unit === 'g') {
          return `${size} Gbps`;
        } else if (unit === 'm') {
          return `${size} Mbps`;
        }
      }
      
      return value;
    }
    
    // 对于内网带宽
    if (type.includes("内网带宽")) {
      // 已经包含单位或描述的情况
      if (value.toLowerCase().includes("gbps") || 
          value.toLowerCase().includes("mbps") || 
          value.toLowerCase().includes("gbit") || 
          value.toLowerCase().includes("内网") || 
          value.toLowerCase().includes("vrack")) {
        return value;
      }
      
      // 处理vrack-bandwidth格式
      const vrackBwMatch = value.match(/vrack-bandwidth-(\d+)/i);
      if (vrackBwMatch) {
        const bwValue = parseInt(vrackBwMatch[1]);
        if (bwValue >= 1000) {
          return `${bwValue/1000} Gbps 内网`.replace(".0 ", " ");
        }
        return `${bwValue} Mbps 内网`;
      }
      
      // 尝试处理纯数字
      if (!isNaN(Number(value))) {
        const num = Number(value);
        if (num >= 1000) {
          return `${(num/1000).toFixed(1)} Gbps 内网`;
        }
        return `${num} Mbps 内网`;
      }
      
      // 尝试匹配带宽格式
      const bwMatch = value.match(/(\d+)([mg])/i);
      if (bwMatch) {
        const size = parseInt(bwMatch[1]);
        const unit = bwMatch[2].toLowerCase();
        if (unit === 'g') {
          return `${size} Gbps 内网`;
        } else if (unit === 'm') {
          return `${size} Mbps 内网`;
        }
      }
      
      return value;
    }
    
    return value;
  };

  // Check availability for a specific server plan
  const checkAvailability = async (planCode: string) => {
    if (!isAuthenticated) {
      toast.error("请先配置 API 设置");
      return;
    }
    
    setIsCheckingAvailability(true);
    try {
      const response = await axios.get(`${API_URL}/availability/${planCode}`);
      console.log(`获取到 ${planCode} 的可用性数据:`, response.data);
      
      setAvailability(prev => ({
        ...prev,
        [planCode]: response.data
      }));
      
      toast.success(`已更新 ${planCode} 可用性信息`);
    } catch (error) {
      console.error(`Error checking availability for ${planCode}:`, error);
      toast.error(`获取 ${planCode} 可用性失败`);
    } finally {
      setIsCheckingAvailability(false);
    }
  };

  // 切换特定服务器的数据中心选择状态
  const toggleDatacenterSelection = (serverPlanCode: string, datacenter: string) => {
    setSelectedDatacenters(prev => ({
      ...prev,
      [serverPlanCode]: {
        ...prev[serverPlanCode],
        [datacenter]: !prev[serverPlanCode]?.[datacenter]
      }
    }));
  };

  // 全选或取消全选特定服务器的所有数据中心
  const toggleAllDatacenters = (serverPlanCode: string, selected: boolean) => {
    setSelectedDatacenters(prev => {
      const newServerState = { ...prev };
      if (newServerState[serverPlanCode]) {
        Object.keys(newServerState[serverPlanCode]).forEach(dc => {
          newServerState[serverPlanCode][dc] = selected;
        });
      }
      return newServerState;
    });
  };

  // 获取特定服务器已选中的数据中心列表
  const getSelectedDatacentersList = (serverPlanCode: string): string[] => {
    if (!selectedDatacenters[serverPlanCode]) return [];
    
    return Object.entries(selectedDatacenters[serverPlanCode])
      .filter(([_, selected]) => selected)
      .map(([dc]) => dc.toLowerCase());
  };

  // 切换选项，支持单选逻辑
  const toggleOption = (serverPlanCode: string, optionValue: string, groupName?: string) => {
    setSelectedOptions(prev => {
      let currentOptions = [...(prev[serverPlanCode] || [])];
      const index = currentOptions.indexOf(optionValue);
      
      if (index >= 0) {
        // 如果选项已经选中，则移除它
        currentOptions.splice(index, 1);
      } else {
        // 如果选项未选中，并且提供了组名，则实现单选逻辑
        if (groupName) {
          // 获取服务器的所有可用选项
          const serverOptions = servers.find(s => s.planCode === serverPlanCode)?.availableOptions || [];
          
          // 找出同组中的其他选项，并从当前选中列表中移除
          serverOptions.forEach(option => {
            const optionFamily = option.family?.toLowerCase() || "";
            const optionLabel = option.label.toLowerCase();
            
            // 检查此选项是否属于同一组
            let isInSameGroup = false;
            
            if (groupName === "CPU/处理器" && 
                (optionFamily.includes("cpu") || optionFamily.includes("processor") || 
                 optionLabel.includes("cpu") || optionLabel.includes("processor"))) {
              isInSameGroup = true;
            } else if (groupName === "内存" && 
                      (optionFamily.includes("memory") || optionFamily.includes("ram") || 
                       optionLabel.includes("ram") || optionLabel.includes("memory"))) {
              isInSameGroup = true;
            } else if (groupName === "存储" && 
                      (optionFamily.includes("storage") || optionFamily.includes("disk") || 
                       optionLabel.includes("ssd") || optionLabel.includes("hdd"))) {
              isInSameGroup = true;
            } else if (groupName === "带宽/网络" && 
                      (optionFamily.includes("bandwidth") || optionFamily.includes("traffic") || 
                       optionLabel.includes("bandwidth") || optionLabel.includes("network"))) {
              isInSameGroup = true;
            } else if (groupName === "vRack内网" && 
                      (option.value.toLowerCase().includes("vrack") || 
                       optionLabel.includes("vrack") || optionLabel.includes("内网"))) {
              isInSameGroup = true;
            }
            
            // 如果是同组选项且不是当前选择的选项，则从选中列表中移除
            if (isInSameGroup && option.value !== optionValue) {
              const idx = currentOptions.indexOf(option.value);
              if (idx >= 0) {
                currentOptions.splice(idx, 1);
              }
            }
          });
        }
        
        // 添加当前选择的选项
        currentOptions.push(optionValue);
      }
      
      return {
        ...prev,
        [serverPlanCode]: currentOptions
      };
    });
  };

  // 判断选项是否已选中
  const isOptionSelected = (serverPlanCode: string, optionValue: string): boolean => {
    return selectedOptions[serverPlanCode]?.includes(optionValue) || false;
  };

  // 添加到抢购队列的函数，支持多数据中心
  const addToQueue = async (server: ServerPlan, datacenters: string[]) => {
    if (!isAuthenticated) {
      toast.error("请先配置 API 设置");
      return;
    }

    if (datacenters.length === 0) {
      toast.error("请至少选择一个数据中心");
      return;
    }
    
    try {
      // 获取用户选择的配置选项
      const userSelectedOptions = selectedOptions[server.planCode]?.length > 0 
        ? selectedOptions[server.planCode] 
        : server.defaultOptions.map(opt => opt.value);

      // 将用户选择的配置分类整理为可读的格式
      const formattedOptions: Record<string, string[]> = {};
      const categorizeOption = (optionValue: string) => {
        const option = server.availableOptions.find(opt => opt.value === optionValue);
        if (!option) return null;
        
        // 尝试确定选项类别
        let category = "其他";
        const value = option.value.toLowerCase();
        const label = option.label.toLowerCase();
        
        if (value.includes("ram-") || label.includes("内存") || label.includes("memory")) {
          category = "内存";
        } else if (value.includes("softraid") || value.includes("raid") || 
                  label.includes("存储") || label.includes("storage") || 
                  label.includes("ssd") || label.includes("hdd") || label.includes("nvme")) {
          category = "存储";
        } else if (value.includes("bandwidth") || value.includes("traffic") || 
                  label.includes("带宽") || label.includes("bandwidth")) {
          category = "网络";
          }
          
        if (!formattedOptions[category]) {
          formattedOptions[category] = [];
        }
        formattedOptions[category].push(option.label);
        
        return option;
      };
      
      // 处理所有选中的选项
      const selectedOptionDetails = userSelectedOptions.map(categorizeOption).filter(Boolean);
      
      console.log("用户选择的配置详情:", formattedOptions);
      console.log("提交的配置选项:", userSelectedOptions);

      // 为每个选中的数据中心创建一个抢购请求
      const promises = datacenters.map(datacenter => 
        axios.post(`${API_URL}/queue`, {
          planCode: server.planCode,
          datacenter,
          options: userSelectedOptions,
        })
      );
      
      await Promise.all(promises);
      
      // 构建成功消息，包含用户选择的配置详情
      let successMessage = `已将 ${server.planCode} 添加到 ${datacenters.length} 个数据中心的抢购队列`;
      
      // 如果有自定义配置，添加到成功消息中
      if (userSelectedOptions.length > 0 && userSelectedOptions.some(opt => !server.defaultOptions.map(o => o.value).includes(opt))) {
        successMessage += `\n已选配置: `;
        Object.entries(formattedOptions).forEach(([category, options]) => {
          successMessage += `${category}(${options.join(', ')}) `;
        });
      }
      
      toast.success(successMessage);
    } catch (error) {
      console.error("Error adding to queue:", error);
      toast.error("添加到抢购队列失败");
    }
  };

  // Subscribe to API auth changes to reload servers when auth status changes
  useEffect(() => {
    // 首次加载时，先尝试从缓存加载
    const loadInitialData = async () => {
      // 尝试从缓存加载
      const loadedFromCache = loadFromCache();
      hasLoadedFromCache.current = loadedFromCache;
      
      if (loadedFromCache) {
        console.log("成功从缓存加载数据");
        
        // 如果缓存过期，则在后台刷新数据
        if (isCacheExpired()) {
          console.log("缓存已过期，在后台刷新数据 (通过 loadInitialData)");
          fetchServers(true);
        }
      } else {
        // 如果缓存加载失败，则直接从API获取
        console.log("缓存加载失败或无缓存，从API获取数据 (通过 loadInitialData)");
        fetchServers(true);
      }
    };
    
    loadInitialData();
    
    // 设置定时刷新
    refreshTimerRef.current = setInterval(() => {
      console.log("定时刷新服务器数据...");
      fetchServers(true); // 强制刷新
    }, REFRESH_INTERVAL);
    
    // Subscribe to auth change events
    const unsubscribe = apiEvents.onAuthChanged(() => {
      console.log("认证状态改变事件触发，尝试获取服务器 (将尊重缓存和isActuallyFetching状态)");
      fetchServers(); // 修改为 fetchServers()，不再强制刷新，让函数内部逻辑判断
    });
    
    return () => {
      // 清理定时器
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
      unsubscribe();
    };
  }, []);

  // Apply filters when search term or datacenter changes
  useEffect(() => {
    if (servers.length === 0) return;
    
    let filtered = [...servers];
    
    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        server => 
          server.planCode.toLowerCase().includes(term) ||
          server.name.toLowerCase().includes(term) ||
          server.cpu.toLowerCase().includes(term) ||
          server.memory.toLowerCase().includes(term)
      );
    }
    
    // Apply datacenter filter - 现在所有服务器都支持所有数据中心
    if (selectedDatacenter !== "all") {
      // 所有服务器都保留，因为我们假设每个服务器都可以在所有数据中心部署
      // 实际应用中可能需要根据API返回的真实可用性进行过滤
    }
    
    setFilteredServers(filtered);
  }, [searchTerm, selectedDatacenter, servers]);

  // 初始化选项
  useEffect(() => {
    // 如果服务器数据加载完成，初始化默认选项
    if (servers.length > 0) {
      const defaultServerOptions: Record<string, string[]> = {};
      servers.forEach(server => {
        defaultServerOptions[server.planCode] = server.defaultOptions.map(opt => opt.value);
      });
      setSelectedOptions(defaultServerOptions);
    }
  }, [servers]);

  // 分类并显示服务器配置选项
  const renderServerOptions = (server: ServerPlan) => {
    // 过滤掉许可证相关的选项，只保留硬件相关选项
    const filteredOptions = server.availableOptions ? server.availableOptions.filter(option => {
      const optionValue = option.value.toLowerCase();
      const optionLabel = option.label.toLowerCase();
      
      // 排除许可证相关选项
      if (
        // Windows许可证
        optionValue.includes("windows-server") ||
        // SQL Server许可证
        optionValue.includes("sql-server") ||
        // cPanel许可证
        optionValue.includes("cpanel-license") ||
        // Plesk许可证
        optionValue.includes("plesk-") ||
        // 其他常见许可证
        optionValue.includes("-license-") ||
        // 操作系统选项
        optionValue.startsWith("os-") ||
        // 控制面板
        optionValue.includes("control-panel") ||
        optionValue.includes("panel") ||
        // 安全产品
        optionLabel.includes("license") ||
        optionLabel.includes("许可证") ||
        optionLabel.includes("许可") ||
        // 安全产品
        optionValue.includes("security") ||
        optionValue.includes("antivirus") ||
        optionValue.includes("firewall")
      ) {
        return false;
      }
      
      return true;
    }) : [];
    
    const filteredDefaultOptions = server.defaultOptions ? server.defaultOptions.filter(option => {
      const optionValue = option.value.toLowerCase();
      const optionLabel = option.label.toLowerCase();
      
      // 排除许可证相关选项
      if (
        // Windows许可证
        optionValue.includes("windows-server") ||
        // SQL Server许可证
        optionValue.includes("sql-server") ||
        // cPanel许可证
        optionValue.includes("cpanel-license") ||
        // Plesk许可证
        optionValue.includes("plesk-") ||
        // 其他常见许可证
        optionValue.includes("-license-") ||
        // 操作系统选项
        optionValue.startsWith("os-") ||
        // 控制面板
        optionValue.includes("control-panel") ||
        optionValue.includes("panel") ||
        // 其他软件许可
        optionLabel.includes("license") ||
        optionLabel.includes("许可证") ||
        optionLabel.includes("许可") ||
        // 安全产品
        optionValue.includes("security") ||
        optionValue.includes("antivirus") ||
        optionValue.includes("firewall")
      ) {
        return false;
      }
      
      return true;
    }) : [];
    
    // 如果没有任何硬件相关的可选和默认配置，则不显示任何内容
    if (filteredOptions.length === 0 && filteredDefaultOptions.length === 0) {
      return null;
    }
    
    // 判断可选配置和默认配置内容是否完全一致
    const defaultSet = new Set(filteredDefaultOptions.map(opt => opt.value));
    const optionSet = new Set(filteredOptions.map(opt => opt.value));
    let optionsIdentical = false;
    if (defaultSet.size === optionSet.size && [...defaultSet].every(v => optionSet.has(v))) {
      optionsIdentical = true;
    }

    // 尝试根据选项分类将选项分组
    const optionGroups: Record<string, ServerOption[]> = {
      "CPU/处理器": [],
      "内存": [],
      "存储": [],
      "带宽/网络": [],
      "vRack内网": [],
      "其他": []
    };
    
    // 根据family或描述关键字分配选项到不同分组
    filteredOptions.forEach(option => {
      const family = option.family?.toLowerCase() || "";
      const desc = option.label.toLowerCase();
      const value = option.value.toLowerCase();
      
      if (family.includes("cpu") || family.includes("processor") || 
          desc.includes("cpu") || desc.includes("processor") || 
          desc.includes("intel") || desc.includes("amd") || 
          desc.includes("xeon") || desc.includes("epyc") || 
          desc.includes("ryzen") || desc.includes("core")) {
        optionGroups["CPU/处理器"].push(option);
      }
      else if (family.includes("memory") || family.includes("ram") || 
               desc.includes("ram") || desc.includes("memory") || 
               desc.includes("gb") || desc.includes("ddr")) {
        optionGroups["内存"].push(option);
      }
      else if (family.includes("storage") || family.includes("disk") || 
               desc.includes("ssd") || desc.includes("hdd") || 
               desc.includes("nvme") || desc.includes("storage") || 
               desc.includes("disk") || desc.includes("raid")) {
        optionGroups["存储"].push(option);
      }
      else if (value.includes("vrack") || desc.includes("vrack") || 
               desc.includes("内网") || family.includes("vrack")) {
        optionGroups["vRack内网"].push(option);
      }
      else if (family.includes("bandwidth") || family.includes("traffic") || 
               desc.includes("bandwidth") || desc.includes("network") || 
               desc.includes("ip") || desc.includes("带宽") || 
               desc.includes("mbps") || desc.includes("gbps")) {
        optionGroups["带宽/网络"].push(option);
      }
      else {
        optionGroups["其他"].push(option);
      }
    });
    
    // 检查是否有任何选项被分组（确保至少有一个组有内容）
    const hasGroupedOptions = Object.values(optionGroups).some(group => group.length > 0);
    
    // 格式化选项显示值的函数
    const formatOptionDisplay = (option: ServerOption, groupName: string) => {
      let displayLabel = option.label;
      let detailLabel = option.value;
      
      // 对于RAM，尝试提取内存大小
      if (groupName === "内存" && option.value.includes("ram-")) {
        const ramMatch = option.value.match(/ram-(\d+)g/i);
        if (ramMatch) {
          displayLabel = `${ramMatch[1]} GB`;
        }
      }
      
      // 对于存储，尝试提取容量和类型
      if (groupName === "存储" && (option.value.includes("raid") || option.value.includes("ssd") || option.value.includes("hdd") || option.value.includes("nvme"))) {
        // 匹配 hybridsoftraid-2x6000sa-2x512nvme-24rise 这样的格式
        const hybridRaidMatch = option.value.match(/hybridsoftraid-(\d+)x(\d+)(sa|ssd|hdd)-(\d+)x(\d+)(nvme|ssd|hdd)/i);
        if (hybridRaidMatch) {
          const count1 = hybridRaidMatch[1];
          const size1 = hybridRaidMatch[2];
          const type1 = hybridRaidMatch[3].toUpperCase();
          const count2 = hybridRaidMatch[4];
          const size2 = hybridRaidMatch[5];
          const type2 = hybridRaidMatch[6].toUpperCase();
          displayLabel = `混合RAID ${count1}x ${size1}GB ${type1} + ${count2}x ${size2}GB ${type2}`;
        } else {
          // 标准RAID格式
          const storageMatch = option.value.match(/(raid|softraid)-(\d+)x(\d+)(sa|ssd|hdd|nvme)/i);
          if (storageMatch) {
            const raidType = storageMatch[1].toUpperCase();
            const count = storageMatch[2];
            const size = storageMatch[3];
            const diskType = storageMatch[4].toUpperCase();
            displayLabel = `${raidType} ${count}x ${size}GB ${diskType}`;
          }
        }
      }
      
      // 对于带宽，尝试提取速率
      if (groupName === "带宽/网络" && (option.value.includes("bandwidth") || option.value.includes("traffic"))) {
        const bwMatch = option.value.match(/bandwidth-(\d+)/i);
        if (bwMatch) {
          const speed = parseInt(bwMatch[1]);
          displayLabel = speed >= 1000 
            ? `${speed/1000} Gbps` 
            : `${speed} Mbps`;
        }
        
        // 匹配格式如 traffic-25tb-1000-24rise-apac
        const combinedTrafficMatch = option.value.match(/traffic-(\d+)(tb|gb|mb)-(\d+)/i);
        if (combinedTrafficMatch) {
          const trafficSize = combinedTrafficMatch[1];
          const trafficUnit = combinedTrafficMatch[2].toUpperCase();
          const bandwidth = combinedTrafficMatch[3];
          displayLabel = `${bandwidth} Mbps / ${trafficSize} ${trafficUnit}流量`;
        } else {
          // 匹配仅有流量限制的格式 traffic-25tb
          const trafficMatch = option.value.match(/traffic-(\d+)(tb|gb)/i);
          if (trafficMatch) {
            displayLabel = `${trafficMatch[1]} ${trafficMatch[2].toUpperCase()} 流量`;
          }
        }

        // 匹配无限流量
        if (option.value.toLowerCase().includes("unlimited")) {
          displayLabel = `无限流量`;
        }
      }
      
      // 对于vRack内网带宽，单独处理
      if (groupName === "vRack内网") {
        const vrackBwMatch = option.value.match(/vrack-bandwidth-(\d+)/i);
        if (vrackBwMatch) {
          const speed = parseInt(vrackBwMatch[1]);
          displayLabel = speed >= 1000 
            ? `${speed/1000} Gbps 内网带宽` 
            : `${speed} Mbps 内网带宽`;
        }
        
        // 匹配其他vRack相关选项
        if (option.value.toLowerCase().includes("vrack") && !option.value.toLowerCase().includes("bandwidth")) {
          displayLabel = `vRack ${option.label}`;
        }
      }
      
      return { displayLabel, detailLabel };
    };
    
    // 极简配置选项渲染
    return (
      <div className="mt-3">
        {/* 默认配置 - 清晰展示 */}
        {filteredDefaultOptions.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center mb-1.5">
              <ArrowRightLeft size={14} className="mr-1.5 text-cyber-accent" />
              <span className="text-sm font-medium text-cyber-accent">默认配置</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {filteredDefaultOptions.map(option => {
                  // 确定此选项属于哪个组
                  let groupName = "其他";
                  for (const [name, group] of Object.entries(optionGroups)) {
                    if (group.some(o => o.value === option.value)) {
                      groupName = name;
                      break;
                    }
                  }
                  
                const { displayLabel } = formatOptionDisplay(option, groupName);
                  
                  return (
                    <div
                      key={option.value}
                    className="bg-cyber-accent/10 px-3 py-1 rounded text-sm border border-cyber-accent/20"
                    >
                      <span className="font-medium">{displayLabel}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        
        {/* 自定义配置 - 极简布局 */}
        {!optionsIdentical && hasGroupedOptions && (
          <div className="rounded-md border border-cyber-accent/20 overflow-hidden">
            <div className="px-2 py-1.5 bg-slate-800/40 border-b border-cyber-accent/20 flex items-center">
              <Settings size={12} className="mr-1 text-cyber-accent" />
              <span className="text-xs font-medium text-cyber-accent">自定义配置</span>
            </div>
            
            {/* 极简网格布局 */}
            <div className="p-2 bg-slate-900/20">
              {Object.entries(optionGroups).map(([groupName, options]) => {
                if (options.length === 0) return null;
                
                // 获取对应的图标
                let GroupIcon = Settings;
                if (groupName === "CPU/处理器") GroupIcon = Cpu;
                else if (groupName === "内存") GroupIcon = Database;
                else if (groupName === "存储") GroupIcon = HardDrive;
                else if (groupName === "带宽/网络") GroupIcon = Wifi;
                else if (groupName === "vRack内网") GroupIcon = ArrowRightLeft;
                
                return (
                  <div key={groupName} className="mb-2 last:mb-0">
                    <div className="flex items-center mb-1">
                      <GroupIcon size={10} className="mr-1 text-cyber-accent" />
                      <span className="text-xs font-medium text-cyber-accent">{groupName}</span>
                    </div>
                    
                    {/* 极简横向布局 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      {options.map(option => {
                        const { displayLabel, detailLabel } = formatOptionDisplay(option, groupName);
                        const isSelected = isOptionSelected(server.planCode, option.value);
                        
                        return (
                            <label 
                            key={option.value}
                            className={`flex items-center p-1.5 rounded cursor-pointer transition-colors border
                                ${isSelected 
                                ? 'bg-cyber-accent/15 border-cyber-accent/40' 
                                : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40 hover:border-cyber-accent/30'}`}
                            >
                            <div className="relative mr-1.5 flex items-center justify-center w-3.5 h-3.5 flex-shrink-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleOption(server.planCode, option.value, groupName)}
                                    className="opacity-0 absolute w-full h-full cursor-pointer"
                                  />
                              <div className={`w-3.5 h-3.5 border rounded-sm flex items-center justify-center ${isSelected ? 'border-cyber-accent bg-cyber-accent/30' : 'border-slate-500'}`}>
                                    {isSelected && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-cyber-accent">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                      </svg>
                                    )}
                                  </div>
                                </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate leading-tight">{displayLabel}</div>
                              <div className="text-[10px] text-slate-400 font-mono truncate leading-tight">{detailLabel}</div>
                              </div>
                            </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* 已选配置摘要 - 极简 */}
        {selectedOptions[server.planCode]?.length > 0 && 
         !selectedOptions[server.planCode].every(opt => server.defaultOptions.map(o => o.value).includes(opt)) && (
          <div className="mt-1.5 p-1.5 bg-cyber-accent/10 border border-cyber-accent/30 rounded-md">
            <div className="text-xs font-medium text-cyber-accent mb-0.5 flex items-center">
              <CheckSquare size={10} className="mr-1" />
              已选配置
            </div>
            <div className="flex flex-wrap gap-0.5">
              {selectedOptions[server.planCode].map(optValue => {
                const option = server.availableOptions.find(o => o.value === optValue);
                if (!option || server.defaultOptions.map(o => o.value).includes(optValue)) return null;
                
                let groupName = "其他";
                for (const [name, group] of Object.entries(optionGroups)) {
                  if (group.some(o => o.value === optValue)) {
                    groupName = name;
                    break;
                  }
                }
                
                const { displayLabel } = formatOptionDisplay(option, groupName);
                
                return (
                  <div key={optValue} className="px-1.5 py-0.5 bg-cyber-accent/20 rounded text-xs flex items-center">
                    {displayLabel}
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleOption(server.planCode, optValue);
                      }} 
                      className="ml-1 text-cyber-muted hover:text-cyber-accent"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* 简洁友好的头部 */}
      <div className="bg-slate-900/95 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">服务器列表</h1>
              <p className="text-slate-400 text-sm">浏览可用服务器与实时可用性检测</p>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-slate-300 font-medium">
                  {isLoading ? '正在同步数据...' : `共 ${servers.length} 台服务器`}
                </div>
                <div className="text-xs text-slate-500">
                  更新于: {lastUpdated ? lastUpdated.toLocaleTimeString() : '未知'}
                </div>
              </div>
              <div className={`w-3 h-3 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`}></div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      
        {/* 搜索和筛选区域 */}
        <div className="bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="搜索服务器型号或配置..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <select
                  value={selectedDatacenter}
                  onChange={(e) => setSelectedDatacenter(e.target.value)}
                  className="pl-10 pr-8 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all appearance-none cursor-pointer min-w-[200px]"
                >
                  <option value="all">所有数据中心</option>
                  {OVH_DATACENTERS.map((dc) => (
                    <option key={dc.code} value={dc.code.toUpperCase()}>
                      {dc.code.toUpperCase()} - {dc.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
              </div>
              
              <button
                onClick={() => {
                  // 检测所有服务器的可用性
                  filteredServers.forEach(server => {
                    checkAvailability(server.planCode);
                  });
                }}
                disabled={isCheckingAvailability}
                className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-all disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isCheckingAvailability ? 'animate-spin' : ''}`} />
                {isCheckingAvailability ? '检测中...' : '检测可用性'}
              </button>
            </div>
          </div>
          
          {/* 提示信息 */}
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-100">
                可用性检测基于默认配置。自定义配置的实际库存以抢购时为准，建议选择多个数据中心提高成功率。
              </p>
            </div>
          </div>
        </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse border-cyber-accent/30">
              <CardHeader className="bg-cyber-grid/10">
                <div className="h-6 bg-cyber-grid/30 rounded w-1/3"></div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="h-5 bg-cyber-grid/20 rounded"></div>
                  <div className="h-5 bg-cyber-grid/20 rounded w-5/6"></div>
                  <div className="h-5 bg-cyber-grid/20 rounded w-4/6"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredServers.length === 0 ? (
        <Card className="border-cyber-accent/30 py-10">
          <CardContent className="flex flex-col items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyber-muted mx-auto mb-4">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
            <p className="text-cyber-muted mb-4">没有找到匹配的服务器</p>
            <Button 
              onClick={() => {
                setSearchTerm("");
                setSelectedDatacenter("all");
              }}
              variant="cyber"
              size="sm"
            >
              清除筛选
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4"
        >
          {filteredServers.map((server) => (
            <motion.div 
              key={server.planCode}
              variants={itemVariants}
            >
              <Card className="border-slate-700/50 overflow-hidden h-full bg-gradient-to-br from-slate-900/80 to-slate-800/60 shadow-xl shadow-slate-900/20 backdrop-blur-sm">
                {/* Modern Header */}
                <CardHeader className="px-6 py-5 bg-gradient-to-r from-cyber-accent/10 via-cyber-primary/5 to-transparent border-b border-slate-700/50 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-cyber-accent/5 to-transparent"></div>
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-3 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-xl border border-cyber-accent/30 shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyber-accent">
                          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                          <line x1="6" y1="6" x2="6.01" y2="6"></line>
                          <line x1="6" y1="18" x2="6.01" y2="18"></line>
                        </svg>
                      </div>
                      <div>
                        <CardTitle className="text-2xl font-bold text-white mb-1">{server.planCode}</CardTitle>
                        <p className="text-slate-300 font-medium">{server.name}</p>
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-cyber-accent/15 to-cyber-primary/15 px-4 py-2 rounded-xl text-sm border border-cyber-accent/30 text-cyber-accent font-semibold shadow-lg backdrop-blur-sm">
                      {server.name}
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="p-6">
                  {/* Modern Hardware Specs */}
                  <div className="mb-6">
                    <div className="flex items-center mb-4">
                      <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30 mr-3">
                        <Settings size={18} className="text-cyber-accent" />
                      </div>
                      <h3 className="text-lg font-bold text-white">硬件规格</h3>
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="group flex items-center space-x-3 p-4 bg-gradient-to-br from-slate-800/60 to-slate-700/40 rounded-xl border border-slate-600/50 hover:border-cyber-accent/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyber-accent/10">
                        <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30">
                      <Cpu size={18} className="text-cyber-accent" />
                      </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-400 mb-1">CPU</div>
                          <div className="font-semibold text-sm text-white truncate">{formatServerSpec(server.cpu, "CPU")}</div>
                    </div>
                      </div>
                      <div className="group flex items-center space-x-3 p-4 bg-gradient-to-br from-slate-800/60 to-slate-700/40 rounded-xl border border-slate-600/50 hover:border-cyber-accent/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyber-accent/10">
                        <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30">
                      <Database size={18} className="text-cyber-accent" />
                      </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-400 mb-1">内存</div>
                          <div className="font-semibold text-sm text-white truncate">{formatServerSpec(server.memory, "内存")}</div>
                    </div>
                      </div>
                      <div className="group flex items-center space-x-3 p-4 bg-gradient-to-br from-slate-800/60 to-slate-700/40 rounded-xl border border-slate-600/50 hover:border-cyber-accent/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyber-accent/10">
                        <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30">
                      <HardDrive size={18} className="text-cyber-accent" />
                      </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-400 mb-1">存储</div>
                          <div className="font-semibold text-sm text-white truncate">{formatServerSpec(server.storage, "存储")}</div>
                    </div>
                      </div>
                      <div className="group flex items-center space-x-3 p-4 bg-gradient-to-br from-slate-800/60 to-slate-700/40 rounded-xl border border-slate-600/50 hover:border-cyber-accent/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyber-accent/10">
                        <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30">
                      <Wifi size={18} className="text-cyber-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-400 mb-1">带宽</div>
                          <div className="font-semibold text-sm text-white truncate">{formatServerSpec(server.bandwidth, "带宽")}</div>
                        </div>
                      </div>
                    </div>
                    {server.vrackBandwidth && server.vrackBandwidth !== "N/A" && (
                      <div className="mt-4 flex items-center space-x-3 p-4 bg-gradient-to-br from-slate-800/60 to-slate-700/40 rounded-xl border border-slate-600/50">
                        <div className="p-2 bg-gradient-to-br from-cyber-accent/20 to-cyber-primary/20 rounded-lg border border-cyber-accent/30">
                        <ArrowRightLeft size={18} className="text-cyber-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-400 mb-1">内网带宽</div>
                          <div className="font-semibold text-sm text-white">{formatServerSpec(server.vrackBandwidth, "内网带宽")}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* 服务器配置选项 */}
                  {renderServerOptions(server)}
                  
                  {/* Elegant Datacenters Section */}
                  <div className="mt-6">
                    {/* 蓝色科技风格头部 */}
                    <div className="relative mb-6 overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-cyan-500/5 to-blue-500/10"></div>
                      <div className="relative p-6 bg-slate-800/40 backdrop-blur-md rounded-xl border border-blue-500/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl border border-blue-400/40 flex items-center justify-center backdrop-blur-sm">
                              <Database className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold text-white mb-1 tracking-wide">数据中心部署</h3>
                              <p className="text-blue-200/70 text-sm font-medium">
                                已选择 <span className="text-cyan-400 font-bold">{getSelectedDatacentersList(server.planCode).length}</span> 个部署位置
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-3">
                            <button
                              onClick={() => checkAvailability(server.planCode)}
                              disabled={isCheckingAvailability || !isAuthenticated}
                              className="flex items-center space-x-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 disabled:bg-blue-600/10 border border-blue-500/30 rounded-lg text-blue-200 text-sm font-medium transition-all backdrop-blur-sm disabled:cursor-not-allowed"
                            >
                              <RefreshCw className={`w-4 h-4 ${isCheckingAvailability && selectedServer === server.planCode ? 'animate-spin' : ''}`} />
                              <span>{isCheckingAvailability && selectedServer === server.planCode ? '检测中' : '检测可用性'}</span>
                            </button>
                            <button
                              onClick={() => {
                                const selectedDcs = getSelectedDatacentersList(server.planCode);
                                if (selectedDcs.length > 0) {
                                  addToQueue(server, selectedDcs);
                                } else {
                                  toast.error("请至少选择一个数据中心");
                                }
                              }}
                              disabled={!isAuthenticated || getSelectedDatacentersList(server.planCode).length === 0}
                              className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-cyan-600/80 to-blue-600/80 hover:from-cyan-600 hover:to-blue-600 disabled:from-cyan-600/30 disabled:to-blue-600/30 border border-cyan-400/30 rounded-lg text-white font-medium transition-all backdrop-blur-sm shadow-lg disabled:cursor-not-allowed"
                            >
                              <Database className="w-4 h-4" />
                              <span>加入队列</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* 紧凑型控制栏 */}
                    <div className="flex items-center justify-between mb-4 p-3 bg-slate-800/30 backdrop-blur-sm rounded-lg border border-blue-500/20">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-1.5">
                          <div className="w-4 h-4 bg-blue-500/20 rounded flex items-center justify-center">
                            <MapPin className="w-2.5 h-2.5 text-blue-400" />
                          </div>
                          <span className="text-xs font-medium text-blue-100">选择部署位置</span>
                        </div>
                        <div className="h-3 w-px bg-blue-500/30"></div>
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => toggleAllDatacenters(server.planCode, true)}
                            className="flex items-center space-x-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded text-xs text-blue-200 font-medium transition-all"
                          >
                            <CheckSquare className="w-2.5 h-2.5" />
                            <span>全选</span>
                          </button>
                          <button
                            onClick={() => toggleAllDatacenters(server.planCode, false)}
                            className="flex items-center space-x-1 px-2 py-1 bg-blue-800/20 hover:bg-blue-800/30 border border-blue-600/30 rounded text-xs text-blue-300 font-medium transition-all"
                          >
                            <Square className="w-2.5 h-2.5" />
                            <span>清空</span>
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* 蓝色科技风格数据中心网格 */}
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-cyan-500/5 rounded-xl"></div>
                      
                      <div className="relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4">
                        {OVH_DATACENTERS.map(dc => {
                          const dcCode = dc.code.toUpperCase();
                          const availStatus = availability[server.planCode]?.[dcCode.toLowerCase()] || "unknown";
                          const isSelected = selectedDatacenters[server.planCode]?.[dcCode];
                          
                          let statusText = "未知";
                          let statusColor = "text-blue-300";
                          let statusBg = "bg-blue-500/20";
                          let statusBorder = "border-blue-500/30";
                          
                          if (availStatus === "unavailable") {
                            statusText = "不可用";
                            statusColor = "text-red-400";
                            statusBg = "bg-red-500/20";
                            statusBorder = "border-red-500/30";
                          } else if (availStatus && availStatus !== "unknown") {
                            statusText = availStatus.includes("H") ? availStatus : "可用";
                            statusColor = "text-green-400";
                            statusBg = "bg-green-500/20";
                            statusBorder = "border-green-500/30";
                          }
                          
                          return (
                            <div 
                              key={dcCode}
                              className="group relative cursor-pointer transition-all duration-300 ease-out transform hover:scale-105"
                              onClick={() => toggleDatacenterSelection(server.planCode, dcCode)}
                            >
                              {/* 蓝色科技风格卡片 */}
                              <div className={`relative rounded-xl border-2 transition-all duration-300 backdrop-blur-sm ${
                                isSelected 
                                  ? 'bg-gradient-to-br from-blue-600/40 to-cyan-600/40 border-cyan-400 shadow-lg shadow-cyan-500/20' 
                                  : 'bg-blue-900/20 border-blue-500/30 hover:bg-blue-600/20 hover:border-blue-400/50'
                              }`}>
                                
                                {/* 选中时的现代勾勾设计 */}
                                {isSelected && (
                                  <div className="absolute -top-2 -right-2 z-10">
                                    <div className="relative">
                                      <div className="w-6 h-6 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30 border-2 border-white/20">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                          <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                      </div>
                                      <div className="absolute inset-0 rounded-full border-2 border-emerald-300/40 animate-ping"></div>
                                    </div>
                                  </div>
                                )}
                                
                                <div className="p-4">
                                  {/* 数据中心信息 */}
                                  <div className="text-center mb-3">
                                    <div className="flex items-center justify-center space-x-2 mb-1">
                                      <span className="font-mono font-bold text-lg text-white">
                                        {dcCode}
                                      </span>
                                      <span className={`fi fi-${dc.countryCode.toLowerCase()} text-base`}></span>
                                    </div>
                                    <div className="text-xs text-blue-200/80 font-medium">{dc.name}</div>
                                  </div>
                                  
                                  {/* 状态徽章 */}
                                  <div className="flex justify-center">
                                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${statusBg} ${statusColor} ${statusBorder}`}>
                                      <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusColor.replace('text-', 'bg-')}`}></div>
                                      {statusText}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
      </div>
    </div>
  );
};

export default ServersPage;