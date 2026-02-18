/**
 * DEX Swap utilities — PancakeSwap V2 on BSC Testnet.
 * Provides real on-chain token swaps using the imported EVM wallet.
 */

import { ethers } from 'ethers';

/* ================================================================ */
/*  BSC Testnet Contract Addresses                                    */
/* ================================================================ */

export const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
export const BSC_TESTNET_CHAIN_ID = 97;
export const BSC_EXPLORER = 'https://testnet.bscscan.com';

export const CONTRACTS = {
    ROUTER: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    FACTORY: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
    WBNB: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    BUSD: '0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee',
} as const;

/* ================================================================ */
/*  Minimal ABIs                                                      */
/* ================================================================ */

const ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function WETH() external pure returns (address)',
];

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
];

/* ================================================================ */
/*  Token list                                                        */
/* ================================================================ */

export interface TestnetToken {
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    icon: string;
}

export const TESTNET_TOKENS: TestnetToken[] = [
    { symbol: 'tBNB', name: 'Testnet BNB', address: CONTRACTS.WBNB, decimals: 18, icon: '🔶' },
    { symbol: 'BUSD', name: 'Binance USD', address: CONTRACTS.BUSD, decimals: 18, icon: '💵' },
];

/* ================================================================ */
/*  Helpers                                                           */
/* ================================================================ */

function getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(BSC_TESTNET_RPC, BSC_TESTNET_CHAIN_ID);
}

function getSigner(privateKey: string): ethers.Wallet {
    return new ethers.Wallet(privateKey, getProvider());
}

function getRouter(signer: ethers.Wallet): ethers.Contract {
    return new ethers.Contract(CONTRACTS.ROUTER, ROUTER_ABI, signer);
}

function getERC20(tokenAddress: string, signerOrProvider: ethers.Wallet | ethers.JsonRpcProvider): ethers.Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
}

/* ================================================================ */
/*  Balance queries                                                   */
/* ================================================================ */

/** Get native BNB balance (human-readable) */
export async function getBNBBalance(address: string): Promise<string> {
    const provider = getProvider();
    const balance = await provider.getBalance(address);
    return ethers.formatEther(balance);
}

/** Get ERC20 token balance (human-readable) */
export async function getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    const provider = getProvider();
    const token = getERC20(tokenAddress, provider);
    const [balance, decimals] = await Promise.all([
        token.balanceOf(address) as Promise<bigint>,
        token.decimals() as Promise<number>,
    ]);
    return ethers.formatUnits(balance, decimals);
}

/* ================================================================ */
/*  Price estimation                                                  */
/* ================================================================ */

/** Get expected output amount for a swap */
export async function getAmountsOut(
    amountIn: string,
    path: string[],
    decimalsIn: number = 18,
): Promise<string> {
    const provider = getProvider();
    const router = new ethers.Contract(CONTRACTS.ROUTER, ROUTER_ABI, provider);
    const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
    const amounts = await router.getAmountsOut(amountInWei, path) as bigint[];
    return ethers.formatUnits(amounts[amounts.length - 1], 18);
}

/* ================================================================ */
/*  Swap: BNB → Token                                                 */
/* ================================================================ */

export interface SwapResult {
    success: boolean;
    txHash: string;
    error?: string;
    amountOut?: string;
}

/**
 * Swap exact BNB for tokens (e.g., BNB → BUSD)
 */
export async function swapBNBForToken(
    privateKey: string,
    tokenAddress: string,
    amountInBNB: string,
    slippagePercent: number = 5,
): Promise<SwapResult> {
    try {
        const signer = getSigner(privateKey);
        const router = getRouter(signer);
        const path = [CONTRACTS.WBNB, tokenAddress];

        const amountInWei = ethers.parseEther(amountInBNB);

        // Get expected output
        const amountsOut = await router.getAmountsOut(amountInWei, path) as bigint[];
        const expectedOut = amountsOut[1];
        const amountOutMin = expectedOut * BigInt(100 - slippagePercent) / 100n;

        const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

        const tx = await router.swapExactETHForTokens(
            amountOutMin,
            path,
            await signer.getAddress(),
            deadline,
            { value: amountInWei },
        );

        const receipt = await tx.wait();
        return {
            success: true,
            txHash: receipt.hash,
            amountOut: ethers.formatUnits(expectedOut, 18),
        };
    } catch (err) {
        return {
            success: false,
            txHash: '',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/* ================================================================ */
/*  Swap: Token → BNB                                                 */
/* ================================================================ */

/**
 * Swap exact tokens for BNB (e.g., BUSD → BNB)
 * Automatically handles ERC20 approve if needed.
 */
export async function swapTokenForBNB(
    privateKey: string,
    tokenAddress: string,
    amountIn: string,
    tokenDecimals: number = 18,
    slippagePercent: number = 5,
): Promise<SwapResult> {
    try {
        const signer = getSigner(privateKey);
        const router = getRouter(signer);
        const token = getERC20(tokenAddress, signer);
        const walletAddress = await signer.getAddress();

        const amountInWei = ethers.parseUnits(amountIn, tokenDecimals);
        const path = [tokenAddress, CONTRACTS.WBNB];

        // Check and set allowance
        const allowance = await token.allowance(walletAddress, CONTRACTS.ROUTER) as bigint;
        if (allowance < amountInWei) {
            const approveTx = await token.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
            await approveTx.wait();
        }

        // Get expected output
        const amountsOut = await router.getAmountsOut(amountInWei, path) as bigint[];
        const expectedOut = amountsOut[1];
        const amountOutMin = expectedOut * BigInt(100 - slippagePercent) / 100n;

        const deadline = Math.floor(Date.now() / 1000) + 600;

        const tx = await router.swapExactTokensForETH(
            amountInWei,
            amountOutMin,
            path,
            walletAddress,
            deadline,
        );

        const receipt = await tx.wait();
        return {
            success: true,
            txHash: receipt.hash,
            amountOut: ethers.formatEther(expectedOut),
        };
    } catch (err) {
        return {
            success: false,
            txHash: '',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
