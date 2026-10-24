import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const factory = await ethers.getContractFactory("CharityChain");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployment = { address, chainId: Number((await ethers.provider.getNetwork()).chainId), deployedAt: new Date().toISOString(), network: network.name };
  fs.mkdirSync(path.join(process.cwd(), "frontend", "src", "generated"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "frontend", "src", "generated", "deployment.json"), JSON.stringify(deployment, null, 2));
  fs.copyFileSync(path.join(process.cwd(), "artifacts", "contracts", "CharityChain.sol", "CharityChain.json"), path.join(process.cwd(), "frontend", "src", "generated", "CharityChain.json"));
  console.log(`CharityChain deployed to ${address} on ${network.name}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
