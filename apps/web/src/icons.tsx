/** Polaris icon adapters — Lucide-compatible `size`/`className` contract, Shopify icons underneath. */
import type { CSSProperties, ReactElement } from 'react'
import type { ComponentType } from 'react'
import { Icon } from '@shopify/polaris'
import {
  AdjustIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  AttachmentIcon,
  AutomationIcon,
  BookIcon,
  BookOpenIcon,
  CalendarIcon,
  CalendarTimeIcon,
  CartIcon,
  ChartLineIcon,
  ChartVerticalIcon,
  ChatIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardCheckIcon,
  ClipboardChecklistIcon,
  ClipboardIcon,
  ClockIcon,
  CollectionIcon,
  ColorIcon,
  ConnectIcon,
  DatabaseIcon,
  DeleteIcon,
  DeliveryIcon,
  DisabledIcon,
  DiscountIcon,
  EditIcon,
  EmailIcon,
  ExportIcon,
  ExternalIcon,
  FileIcon,
  FilterIcon,
  FlagIcon,
  GaugeIcon,
  GiftCardIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  ImageIcon,
  InfoIcon,
  InventoryIcon,
  KeyIcon,
  KeyboardIcon,
  LanguageIcon,
  LayoutBlockIcon,
  LightbulbIcon,
  ListBulletedIcon,
  LiveIcon,
  LocationIcon,
  LockIcon,
  MagicIcon,
  MegaphoneIcon,
  MenuHorizontalIcon,
  MenuIcon,
  MicrophoneIcon,
  MinusIcon,
  MoneyIcon,
  MoonIcon,
  NoteIcon,
  NotificationIcon,
  OrderIcon,
  OrderRepeatIcon,
  OrganizationIcon,
  PackageIcon,
  PauseCircleIcon,
  PersonAddIcon,
  PersonIcon,
  PersonRemoveIcon,
  PlayIcon,
  PlusIcon,
  PrintIcon,
  ProductAddIcon,
  ProductIcon,
  ProductRemoveIcon,
  QuestionCircleIcon,
  RefreshIcon,
  ResetIcon,
  RewardIcon,
  SaveIcon,
  SearchIcon,
  SearchResourceIcon,
  SendIcon,
  SettingsIcon,
  ShareIcon,
  ShieldCheckMarkIcon,
  SortIcon,
  SoundIcon,
  StarIcon,
  StatusIcon,
  StoreIcon,
  SunIcon,
  TargetIcon,
  TeamIcon,
  ThemeTemplateIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UndoIcon,
  ViewIcon,
  WalletIcon,
  WorkIcon,
  XCircleIcon,
  XIcon,
} from '@shopify/polaris-icons'

export type IconProps = Readonly<{ size?: number | string; className?: string; strokeWidth?: number; fill?: string; color?: string; style?: CSSProperties }>
export type LucideIcon = (props: IconProps) => ReactElement

function wrap(source: ComponentType): LucideIcon {
  function Wrapped({ size = 20, className, style }: IconProps): ReactElement {
    const px = typeof size === 'number' ? size : Number.parseInt(String(size), 10) || 20
    const box: CSSProperties = { display: 'inline-flex', width: px, height: px, verticalAlign: 'middle', ...style }
    return <span className={`pp-icon ${className ?? ''}`.trim()} style={box} aria-hidden><Icon source={source as never} /></span>
  }
  return Wrapped
}

export const Activity = wrap(ChartLineIcon)
export const AlertCircle = wrap(AlertCircleIcon)
export const AlertTriangle = wrap(AlertTriangleIcon)
export const Archive = wrap(ArchiveIcon)
export const ArrowDown = wrap(ArrowDownIcon)
export const ArrowDownRight = wrap(ArrowDownIcon)
export const ArrowLeft = wrap(ArrowLeftIcon)
export const ArrowRight = wrap(ArrowRightIcon)
export const ArrowUp = wrap(ArrowUpIcon)
export const ArrowUpDown = wrap(SortIcon)
export const ArrowUpRight = wrap(ExternalIcon)
export const Award = wrap(RewardIcon)
export const Ban = wrap(DisabledIcon)
export const BarChart3 = wrap(ChartVerticalIcon)
export const Bell = wrap(NotificationIcon)
export const BellOff = wrap(NotificationIcon)
export const BellRing = wrap(NotificationIcon)
export const BookOpen = wrap(BookOpenIcon)
export const BookOpenCheck = wrap(BookOpenIcon)
export const Bot = wrap(MagicIcon)
export const Box = wrap(PackageIcon)
export const Boxes = wrap(InventoryIcon)
export const Brain = wrap(MagicIcon)
export const Briefcase = wrap(WorkIcon)
export const Bug = wrap(AlertCircleIcon)
export const Calendar = wrap(CalendarIcon)
export const CalendarClock = wrap(CalendarTimeIcon)
export const CalendarDays = wrap(CalendarIcon)
export const CalendarRange = wrap(CalendarIcon)
export const Camera = wrap(ImageIcon)
export const Check = wrap(CheckIcon)
export const CheckCircle2 = wrap(CheckCircleIcon)
export const ChevronDown = wrap(ChevronDownIcon)
export const ChevronLeft = wrap(ChevronLeftIcon)
export const ChevronRight = wrap(ChevronRightIcon)
export const ChevronUp = wrap(ChevronUpIcon)
export const CircleDashed = wrap(StatusIcon)
export const CircleDollarSign = wrap(MoneyIcon)
export const CircleGauge = wrap(GaugeIcon)
export const CircleHelp = wrap(QuestionCircleIcon)
export const ClipboardCheck = wrap(ClipboardCheckIcon)
export const ClipboardList = wrap(NoteIcon)
export const Clock3 = wrap(ClockIcon)
export const CloudOff = wrap(AlertCircleIcon)
export const Coins = wrap(MoneyIcon)
export const Command = wrap(SearchIcon)
export const Compass = wrap(LocationIcon)
export const Copy = wrap(ClipboardIcon)
export const Crosshair = wrap(TargetIcon)
export const Crown = wrap(StarIcon)
export const Database = wrap(DatabaseIcon)
export const DollarSign = wrap(MoneyIcon)
export const Download = wrap(ExportIcon)
export const ExternalLink = wrap(ExternalIcon)
export const Eye = wrap(ViewIcon)
export const FileBarChart = wrap(ChartVerticalIcon)
export const FileSearch = wrap(SearchResourceIcon)
export const FileSpreadsheet = wrap(FileIcon)
export const FileText = wrap(NoteIcon)
export const Filter = wrap(FilterIcon)
export const Flag = wrap(FlagIcon)
export const Flame = wrap(AlertTriangleIcon)
export const FlaskConical = wrap(MagicIcon)
export const Gauge = wrap(GaugeIcon)
export const Gem = wrap(StarIcon)
export const Gift = wrap(GiftCardIcon)
export const GitBranch = wrap(OrganizationIcon)
export const Globe = wrap(GlobeIcon)
export const Globe2 = wrap(GlobeIcon)
export const Goal = wrap(TargetIcon)
export const GraduationCap = wrap(BookOpenIcon)
export const Grid2X2 = wrap(LayoutBlockIcon)
export const Handshake = wrap(TeamIcon)
export const Heart = wrap(HeartIcon)
export const HeartPulse = wrap(HeartIcon)
export const HelpCircle = wrap(QuestionCircleIcon)
export const History = wrap(ResetIcon)
export const Inbox = wrap(EmailIcon)
export const Info = wrap(InfoIcon)
export const KeyRound = wrap(KeyIcon)
export const Keyboard = wrap(KeyboardIcon)
export const Landmark = wrap(StoreIcon)
export const Languages = wrap(LanguageIcon)
export const Layers = wrap(CollectionIcon)
export const LayoutDashboard = wrap(HomeIcon)
export const LayoutTemplate = wrap(ThemeTemplateIcon)
export const Library = wrap(BookIcon)
export const LifeBuoy = wrap(QuestionCircleIcon)
export const Lightbulb = wrap(LightbulbIcon)
export const LineChart = wrap(ChartLineIcon)
export const List = wrap(ListBulletedIcon)
export const ListChecks = wrap(ClipboardChecklistIcon)
export const ListFilter = wrap(FilterIcon)
export const Loader2 = wrap(RefreshIcon)
export const LoaderCircle = wrap(RefreshIcon)
export const Lock = wrap(LockIcon)
export const LockKeyhole = wrap(LockIcon)
export const Mail = wrap(EmailIcon)
export const Map = wrap(LocationIcon)
export const MapPin = wrap(LocationIcon)
export const Megaphone = wrap(MegaphoneIcon)
export const Menu = wrap(MenuIcon)
export const MessageCircleQuestion = wrap(ChatIcon)
export const MessageSquare = wrap(ChatIcon)
export const Mic = wrap(MicrophoneIcon)
export const MicOff = wrap(MicrophoneIcon)
export const Minus = wrap(MinusIcon)
export const Moon = wrap(MoonIcon)
export const MoonStar = wrap(MoonIcon)
export const MoreHorizontal = wrap(MenuHorizontalIcon)
export const Mountain = wrap(TargetIcon)
export const Network = wrap(ConnectIcon)
export const Newspaper = wrap(NoteIcon)
export const Package = wrap(ProductIcon)
export const PackagePlus = wrap(ProductAddIcon)
export const PackageSearch = wrap(ProductIcon)
export const PackageX = wrap(ProductRemoveIcon)
export const Palette = wrap(ColorIcon)
export const PanelLeftClose = wrap(ChevronLeftIcon)
export const PanelLeftOpen = wrap(ChevronRightIcon)
export const Paperclip = wrap(AttachmentIcon)
export const Pause = wrap(PauseCircleIcon)
export const Pencil = wrap(EditIcon)
export const Percent = wrap(DiscountIcon)
export const Play = wrap(PlayIcon)
export const Plus = wrap(PlusIcon)
export const Printer = wrap(PrintIcon)
export const Quote = wrap(ChatIcon)
export const Radar = wrap(SearchIcon)
export const Radio = wrap(LiveIcon)
export const RefreshCw = wrap(RefreshIcon)
export const Repeat = wrap(OrderRepeatIcon)
export const Rocket = wrap(MagicIcon)
export const RotateCcw = wrap(ResetIcon)
export const Save = wrap(SaveIcon)
export const Scale = wrap(GaugeIcon)
export const Search = wrap(SearchIcon)
export const Send = wrap(SendIcon)
export const Server = wrap(DatabaseIcon)
export const Settings = wrap(SettingsIcon)
export const Settings2 = wrap(SettingsIcon)
export const Share2 = wrap(ShareIcon)
export const ShieldCheck = wrap(ShieldCheckMarkIcon)
export const ShoppingBag = wrap(OrderIcon)
export const ShoppingCart = wrap(CartIcon)
export const SlidersHorizontal = wrap(AdjustIcon)
export const Smile = wrap(PersonIcon)
export const Sparkles = wrap(MagicIcon)
export const Star = wrap(StarIcon)
export const Stethoscope = wrap(AlertCircleIcon)
export const Store = wrap(StoreIcon)
export const Sun = wrap(SunIcon)
export const SunMedium = wrap(SunIcon)
export const Sunrise = wrap(SunIcon)
export const Sunset = wrap(SunIcon)
export const Tag = wrap(DiscountIcon)
export const Target = wrap(TargetIcon)
export const ThumbsDown = wrap(ThumbsDownIcon)
export const ThumbsUp = wrap(ThumbsUpIcon)
export const TicketCheck = wrap(DiscountIcon)
export const Trash2 = wrap(DeleteIcon)
export const TrendingDown = wrap(ArrowDownIcon)
export const TrendingUp = wrap(ArrowUpIcon)
export const TriangleAlert = wrap(AlertTriangleIcon)
export const Trophy = wrap(RewardIcon)
export const Truck = wrap(DeliveryIcon)
export const Undo2 = wrap(UndoIcon)
export const User = wrap(PersonIcon)
export const UserCircle = wrap(PersonIcon)
export const UserPlus = wrap(PersonAddIcon)
export const UserRound = wrap(PersonIcon)
export const UserRoundPlus = wrap(PersonAddIcon)
export const UserX = wrap(PersonRemoveIcon)
export const Users = wrap(TeamIcon)
export const Volume2 = wrap(SoundIcon)
export const Wallet = wrap(WalletIcon)
export const WalletCards = wrap(WalletIcon)
export const Wand2 = wrap(MagicIcon)
export const WandSparkles = wrap(MagicIcon)
export const Waves = wrap(ChartLineIcon)
export const Waypoints = wrap(LocationIcon)
export const Workflow = wrap(AutomationIcon)
export const X = wrap(XIcon)
export const XCircle = wrap(XCircleIcon)
export const Zap = wrap(MagicIcon)

export default {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Award,
  Ban,
  BarChart3,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  BookOpenCheck,
  Bot,
  Box,
  Boxes,
  Brain,
  Briefcase,
  Bug,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  CircleDollarSign,
  CircleGauge,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  CloudOff,
  Coins,
  Command,
  Compass,
  Copy,
  Crosshair,
  Crown,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  FileBarChart,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Filter,
  Flag,
  Flame,
  FlaskConical,
  Gauge,
  Gem,
  Gift,
  GitBranch,
  Globe,
  Globe2,
  Goal,
  GraduationCap,
  Grid2X2,
  Handshake,
  Heart,
  HeartPulse,
  HelpCircle,
  History,
  Inbox,
  Info,
  KeyRound,
  Keyboard,
  Landmark,
  Languages,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  LifeBuoy,
  Lightbulb,
  LineChart,
  List,
  ListChecks,
  ListFilter,
  Loader2,
  LoaderCircle,
  Lock,
  LockKeyhole,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageCircleQuestion,
  MessageSquare,
  Mic,
  MicOff,
  Minus,
  Moon,
  MoonStar,
  MoreHorizontal,
  Mountain,
  Network,
  Newspaper,
  Package,
  PackagePlus,
  PackageSearch,
  PackageX,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  Printer,
  Quote,
  Radar,
  Radio,
  RefreshCw,
  Repeat,
  Rocket,
  RotateCcw,
  Save,
  Scale,
  Search,
  Send,
  Server,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Sun,
  SunMedium,
  Sunrise,
  Sunset,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  TicketCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Undo2,
  User,
  UserCircle,
  UserPlus,
  UserRound,
  UserRoundPlus,
  UserX,
  Users,
  Volume2,
  Wallet,
  WalletCards,
  Wand2,
  WandSparkles,
  Waves,
  Waypoints,
  Workflow,
  X,
  XCircle,
  Zap,
}
