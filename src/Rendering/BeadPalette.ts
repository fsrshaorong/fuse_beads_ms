const COLORS: Readonly<Record<string, string>> = {
    red: '#db766e',
    pink: '#f4b6b0',
    white: '#fff2da',
    black: '#534654',
    green: '#81aa8a',
    blue: '#7aabbc',
    yellow: '#eecb79',
    orange: '#e59d68',
    purple: '#ae90b5',
    brown: '#aa795f',
    cyan: '#86beb7',
    cream: '#f4dfb8',
    'strawberry-shadow': '#A92F45',
    'strawberry-red': '#E75463',
    'strawberry-highlight': '#F78889',
    'strawberry-leaf-dark': '#326A49',
    'strawberry-leaf-light': '#76A85F',
    'strawberry-seed': '#F9DE99'
};

const NAMES: Readonly<Record<string, string>> = {
    red: '珊瑚红', pink: '樱花粉', white: '奶油白', black: '可可黑',
    green: '鼠尾草绿', blue: '雾蓝', yellow: '奶油黄', orange: '杏子橙',
    purple: '丁香紫', brown: '榛果棕', cyan: '薄荷青', cream: '燕麦色',
    'strawberry-shadow': '莓果深红',
    'strawberry-red': '草莓红',
    'strawberry-highlight': '果肉粉',
    'strawberry-leaf-dark': '叶脉深绿',
    'strawberry-leaf-light': '新叶绿',
    'strawberry-seed': '奶油籽'
};

/** Resolves the stable pattern color identifier to the shared bead and UI palette. */
export function getBeadColor(colorId: string): string
{
    return COLORS[colorId] ?? '#bba1b2';
}

/** Gives a readable local label without changing the underlying pattern color ID. */
export function getBeadColorName(colorId: string): string
{
    return NAMES[colorId] ?? colorId;
}
