import { ethers } from "hardhat";

async function main() {
  const [admin, organizer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("CharityChain");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const charityTx = await contract.connect(organizer).registerCharity("Community Education Fund", "Fictional demonstration record for local testing.", "DEMO-EDU-001", "https://example.com/demo-evidence");
  await charityTx.wait();
  const campaignTx = await contract.connect(organizer).createCampaign(1, "School supplies for every learner", "A fictional campaign used to demonstrate on-chain donations.", "Education", ethers.parseEther("10"), "https://example.com/demo-campaign");
  await campaignTx.wait();
  console.log(`Seeded contract at ${await contract.getAddress()} with admin ${admin.address}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
